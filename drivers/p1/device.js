/*
Copyright 2020 - 2022, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.beeclear.

com.gruijter.beeclear is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.beeclear is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.beeclear.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

const { Device } = require('homey');
const Beeclear = require('beeclear');
const util = require('util');

const setTimeoutPromise = util.promisify(setTimeout);

class BeeclearDevice extends Device {

	// this method is called when the Device is inited
	async onInit() {
		this.log('device init: ', this.getName(), 'id:', this.getData().id);
		try {
			// init some stuff
			this.restarting = false;
			this.watchDogCounter = 10;
			const settings = this.getSettings();
			this.meters = {};
			this.initMeters();

			// create session
			const options = {
				host: settings.host,
				port: Number(settings.port),
				username: settings.username,
				password: settings.password,
				useTLS: settings.useTLS,
				timeout: (settings.pollingInterval * 900),
			};
			this.bc = new Beeclear(options);

			// start polling device for info
			this.startPolling(settings.pollingInterval);

		} catch (error) {
			this.error(error);
		}
	}

	startPolling(interval) {
		this.homey.clearInterval(this.intervalIdDevicePoll);
		this.log(`start polling ${this.getName()} @${interval} seconds interval`);
		this.intervalIdDevicePoll = this.homey.setInterval(() => {
			this.doPoll();
		}, interval * 1000);
	}

	stopPolling() {
		this.log(`Stop polling ${this.getName()}`);
		this.homey.clearInterval(this.intervalIdDevicePoll);
	}

	async restartDevice(delay) {
		if (this.restarting) return;
		this.restarting = true;
		this.stopPolling();
		// this.destroyListeners();
		const dly = delay || 2000;
		this.log(`Device will restart in ${dly / 1000} seconds`);
		// this.setUnavailable('Device is restarting. Wait a few minutes!');
		await setTimeoutPromise(dly).then(() => this.onInit());
	}

	// this method is called when the Device is added
	async onAdded() {
		this.log(`Meter added as device: ${this.getName()}`);
	}

	// this method is called when the Device is deleted
	onDeleted() {
		this.stopPolling();
		// this.destroyListeners();
		this.log(`Deleted as device: ${this.getName()}`);
	}

	onRenamed(name) {
		this.log(`Meter renamed to: ${name}`);
	}

	// this method is called when the user has changed the device's settings in Homey.
	async onSettings({ newSettings }) { // , oldSettings, changedKeys) {
		this.log(`${this.getName()} device settings changed`);
		this.log(newSettings);
		this.restartDevice(1000);
		return Promise.resolve(true);
	}

	async doPoll() {
		try {
			if (this.watchDogCounter <= 0) {
				// restart the app here
				this.log('watchdog triggered, restarting device now');
				this.restartDevice(60000);
				return;
			}
			if (this.watchDogCounter < 9 && this.watchDogCounter > 1) {
				// skip some polls
				const isEven = this.watchDogCounter === parseFloat(this.watchDogCounter) ? !(this.watchDogCounter % 2) : undefined;
				if (isEven) {
					this.watchDogCounter -= 1;
					// console.log('skipping poll');
					return;
				}
			}
			// get new readings and update the devicestate
			if (!this.bc.loggedIn) await this.bc.login();
			const readings = await this.bc.getMeterReadings(true);
			if (this.getSettings().filterReadings && !this.isValidReading(readings)) {
				this.watchDogCounter -= 1;
				return;
			}
			this.setAvailable();
			await this.handleNewReadings(readings);
			this.watchDogCounter = 10;
		} catch (error) {
			this.setUnavailable(error.message);
			this.watchDogCounter -= 1;
			this.error('Poll error', error.message);
		}
	}

	initMeters() {
		this.lastMeters = {
			measureGas: 0,							// 'measureGas' (m3)
			meterGas: null, 						// 'meterGas' (m3)
			meterGasTm: 0,							// timestamp of gas meter reading, e.g. 1514394325
			measurePower: 0,						// 'measurePower' (W)
			measurePowerAvg: 0,						// '2 minute average measurePower' (kWh)
			meterPower: null,						// 'meterPower' (kWh)
			meterPowerPeak: null,					// 'meterPower_peak' (kWh)
			meterPowerOffPeak: null,				// 'meterPower_offpeak' (kWh)
			meterPowerPeakProduced: null,			// 'meterPower_peak_produced' (kWh)
			meterPowerOffPeakProduced: null,		// 'meterPower_offpeak_produced' (kWh)
			meterPowerTm: null, 					// timestamp epoch, e.g. 1514394325
			meterPowerInterval: null,				// 'meterPower' at last interval (kWh)
			meterPowerIntervalTm: null, 			// timestamp epoch, e.g. 1514394325
			offPeak: null,							// 'meterPower_offpeak' (true/false)
		};
	}

	async setCapability(capability, value) {
		if (this.hasCapability(capability)) {
			await this.setCapabilityValue(capability, value)
				.catch((error) => {
					this.log(error, capability, value);
				});
		}
	}

	async updateDeviceState(meters) {
		// this.log(`updating states for: ${this.getName()}`);
		try {
			await this.setCapability('meter_offPeak', meters.offPeak);
			await this.setCapability('measure_power', meters.measurePower);
			await this.setCapability('meter_power', meters.meterPower);
			await this.setCapability('measure_gas', meters.measureGas);
			await this.setCapability('meter_gas', meters.meterGas);
			await this.setCapability('meter_power.peak', meters.meterPowerPeak);
			await this.setCapability('meter_power.offPeak', meters.meterPowerOffPeak);
			await this.setCapability('meter_power.producedPeak', meters.meterPowerPeakProduced);
			await this.setCapability('meter_power.producedOffPeak', meters.meterPowerOffPeakProduced);
		} catch (error) {
			this.error(error);
		}
	}

	isValidReading(readings) {
		let validReading = true;
		if (this.lastMeters.meterPowerIntervalTm === null) { // first reading after init
			return validReading;	// We have to assume that the first reading after init is a valid reading :(
		}
		// check if gas readings make sense
		const meterGas = readings.gas;
		if (meterGas < this.lastMeters.meterGas) {
			this.log('negative gas usage');
			validReading = false;
		}
		if (meterGas - this.lastMeters.meterGas > 40) {
			this.log('unrealistic high gas usage > G25');
			validReading = false;
		}
		// check if timestamps make sense
		const { tm, gtm } = readings; // power meter timestamp, gas meter timestamp
		if (tm - this.lastMeters.meterPowerIntervalTm < 0) {
			this.log('power time is negative');
			validReading = false;
		}
		if (gtm - this.lastMeters.meterGasTm < 0) {
			this.log('gas time is negative');
			validReading = false;
		}
		if ((gtm !== 0) && (Math.abs(gtm - tm) > 45000)) {	// > 12 hrs difference
			this.log('gas and power time differ too much');
			validReading = false;
		}
		// check if power readings make sense
		if (Math.abs(readings.pwr) > 56000) {
			this.log('unrealistic high power >3x80A');
			validReading = false;
		}
		const {
			net, p1, p2, n1, n2,
		} = readings;
		if (Math.abs(net - ((p1 + p2) - (n1 + n2))) > 0.1) {
			this.log('power meters do not add up');
			validReading = false;
		}
		const timeDelta = tm - this.lastMeters.meterPowerIntervalTm; // in seconds
		if (Math.abs(net - this.lastMeters.meterPower) / (timeDelta / 60 / 60) > 56) {
			this.log('unrealistic high power meter delta >3x80A / 56KWh');
			validReading = false;
		}
		if (!validReading) {
			// this.log(this.lastMeters);
			this.log(readings);
		}
		return validReading;
	}

	async handleNewReadings(readings) {
		try {
			// console.log(`handling new readings for ${this.getName()}`);
			// gas readings from device
			const meterGas = readings.gas; // gas_cumulative_meter
			const meterGasTm = readings.gtm; // gas_meter_timestamp
			let { measureGas } = this.lastMeters;
			// constructed gas readings
			const meterGasTmChanged = (meterGasTm !== this.lastMeters.meterGasTm) && (this.lastMeters.meterGasTm !== 0);
			if (meterGasTmChanged) {
				const passedHours = (meterGasTm - this.lastMeters.meterGasTm) / 3600;	// timestamp is in seconds
				measureGas = Math.round(1000 * ((meterGas - this.lastMeters.meterGas) / passedHours)) / 1000; // gas_interval_meter
			}
			// electricity readings from device
			const meterPowerOffPeakProduced = readings.n1;
			const meterPowerPeakProduced = readings.n2;
			const meterPowerOffPeak = readings.p1;
			const meterPowerPeak = readings.p2;
			const meterPower = readings.net;
			let measurePower = readings.pwr;
			let { measurePowerAvg } = this.lastMeters;
			const meterPowerTm = readings.tm;
			// constructed electricity readings
			let { offPeak } = this.lastMeters;
			if ((this.lastMeters.meterPowerTm !== null) && ((meterPower - this.lastMeters.meterPower) !== 0)) {
				offPeak = ((meterPowerOffPeakProduced - this.lastMeters.meterPowerOffPeakProduced) > 0
				|| (meterPowerOffPeak - this.lastMeters.meterPowerOffPeak) > 0);
			}
			// measurePowerAvg 2 minutes average based on cumulative meters
			let { meterPowerInterval, meterPowerIntervalTm } = this.lastMeters;
			if (this.lastMeters.meterPowerIntervalTm === null) {	// first reading after init
				meterPowerInterval = meterPower;
				meterPowerIntervalTm = meterPowerTm;
				measurePowerAvg = measurePower;
			}
			if ((meterPowerTm - meterPowerIntervalTm) >= 60) {
				measurePowerAvg = Math.round((3600000 / (meterPowerTm - meterPowerIntervalTm)) * (meterPower - meterPowerInterval));
				meterPowerInterval = meterPower;
				meterPowerIntervalTm = meterPowerTm;
			}
			// correct measurePower with average measurePower_produced in case point_meter_produced is always zero
			const producing = (this.lastMeters.meterPowerTm !== null) && (meterPower <= this.lastMeters.meterPower);
			if (producing && (measurePower < 100) && (measurePower > -50) && (measurePowerAvg < 0)) {
				measurePower = measurePowerAvg;
			}

			// setup custom trigger flowcards
			const tariffChanged = (this.lastMeters.offPeak !== null) && (offPeak !== this.getCapabilityValue('meter_offPeak'));
			const powerChanged = (this.lastMeters.meterPowerTm !== null) && (measurePower !== this.lastMeters.measurePower);

			// update the ledring screensavers
			if (measurePower !== this.lastMeters.measurePower) this.driver.ledring.change(this.getSettings(), measurePower);

			// store the new readings in memory
			const meters = {
				measureGas,
				meterGas,
				meterGasTm,
				measurePower,
				measurePowerAvg,
				meterPower,
				meterPowerPeak,
				meterPowerOffPeak,
				meterPowerPeakProduced,
				meterPowerOffPeakProduced,
				meterPowerTm,
				meterPowerInterval,
				meterPowerIntervalTm,
				offPeak,
			};
			// update the device state
			await this.updateDeviceState(meters);

			// execute flow triggers
			if (tariffChanged) {
				this.log('Tariff changed. offPeak:', offPeak);
				const tokens = { tariff: offPeak };
				this.homey.app.triggerTariffChanged(this, tokens, {});
			}
			if (powerChanged) {
				const measurePowerDelta = (measurePower - this.lastMeters.measurePower);
				const tokens = {
					power: measurePower,
					power_delta: measurePowerDelta,
				};
				this.homey.app.triggerPowerChanged(this, tokens, {});
			}

			// console.log(meters);
			this.lastMeters = meters;
			this.watchDogCounter = 10;
		}	catch (error) {
			this.error(error);
		}
	}

}

module.exports = BeeclearDevice;
