/*
Copyright 2016 - 2019, Robin de Gruijter (gruijter@hotmail.com)

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

const Homey = require('homey');

class P1Device extends Homey.Device {

	// this method is called when the Device is inited
	async onInit() {
		this.log('device init: ', this.getName(), 'id:', this.getData().id);
		try {
			// init some stuff
			this._driver = this.getDriver();
			this._ledring = this._driver.ledring;
			this.handleNewReadings = this._driver.handleNewReadings.bind(this);
			this.watchDogCounter = 10;
			const settings = this.getSettings();
			this.meters = {};
			this.initMeters();
			// create Beeclear session
			const options = {
				host: settings.host,
				port: Number(settings.port),
				username: settings.username,
				password: settings.password,
				useTLS: settings.useTLS,
			};
			this.bc = new this._driver.Beeclear(options);
			// register trigger flow cards of custom capabilities
			this.tariffChangedTrigger = new Homey.FlowCardTriggerDevice('tariff_changed')
				.register();
			this.powerChangedTrigger = new Homey.FlowCardTriggerDevice('power_changed')
				.register();
			// register condition flow cards
			const offPeakCondition = new Homey.FlowCardCondition('offPeak');
			offPeakCondition.register()
				.registerRunListener(() => Promise.resolve(this.meters.lastOffpeak));
			// start polling device for info
			this.intervalIdDevicePoll = setInterval(() => {
				this.doPoll();
			}, 1000 * settings.pollingInterval);
		} catch (error) {
			this.error(error);
		}
	}

	// this method is called when the Device is added
	onAdded() {
		this.log(`Beeclear added as device: ${this.getName()}`);
	}

	// this method is called when the Device is deleted
	onDeleted() {
		// stop polling
		clearInterval(this.intervalIdDevicePoll);
		this.log(`Deleted device: ${this.getName()} ${this.getData().id}`);
	}

	onRenamed(name) {
		this.log(`Beeclear renamed to: ${name}`);
	}

	// this method is called when the user has changed the device's settings in Homey.
	onSettings(oldSettingsObj, newSettingsObj, changedKeysArr, callback) {
		this.log('settings change requested by user');
		// this.log(newSettingsObj);
		this.log(`${this.getName()} device settings changed`);
		// do callback to confirm settings change
		callback(null, true);
		this.restartDevice(1000);
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
					// this.log('skipping poll');
					return;
				}
			}
			// get new readings and update the devicestate
			if (!this.bc.loggedIn) await this.bc.login();
			const readings = await this.bc.getMeterReadings(true);
			this.setAvailable();
			this.handleNewReadings(readings);
			this.watchDogCounter = 10;
		} catch (error) {
			this.setUnavailable(error.message);
			this.watchDogCounter -= 1;
			this.error('Poll error', error.message);
		}
	}

	restartDevice(delay) {
		// stop polling the device, then start init after short delay
		clearInterval(this.intervalIdDevicePoll);
		setTimeout(() => {
			this.onInit();
		}, delay || 10000);
	}

	initMeters() {
		this.meters = {
			lastMeasureGas: 0,										// 'measureGas' (m3)
			lastMeterGas: null, 									// 'meterGas' (m3)
			lastMeterGasTm: 0,										// timestamp of gas meter reading, e.g. 1514394325
			lastMeasurePower: 0,									// 'measurePower' (W)
			lastMeasurePowerAvg: 0,								// '2 minute average measurePower' (kWh)
			lastMeterPower: null,									// 'meterPower' (kWh)
			lastMeterPowerPeak: null,							// 'meterPower_peak' (kWh)
			lastMeterPowerOffpeak: null,					// 'meterPower_offpeak' (kWh)
			lastMeterPowerPeakProduced: null,			// 'meterPower_peak_produced' (kWh)
			lastMeterPowerOffpeakProduced: null,	// 'meterPower_offpeak_produced' (kWh)
			lastMeterPowerTm: null, 							// timestamp epoch, e.g. 1514394325
			lastMeterPowerInterval: null,					// 'meterPower' at last interval (kWh)
			lastMeterPowerIntervalTm: null, 			// timestamp epoch, e.g. 1514394325
			lastOffpeak: null,										// 'meterPower_offpeak' (true/false)
		};
	}

	setCapability(capability, value) {
		if (this.hasCapability(capability)) {
			this.setCapabilityValue(capability, value)
				.catch((error) => {
					this.log(error, capability, value);
				});
		}
	}

	updateDeviceState() {
		// this.log(`updating states for: ${this.getName()}`);
		try {
			this.setCapability('measure_power', this.meters.lastMeasurePower);
			this.setCapability('meter_power', this.meters.lastMeterPower);
			this.setCapability('measure_gas', this.meters.lastMeasureGas);
			this.setCapability('meter_gas', this.meters.lastMeterGas);
			this.setCapability('meter_power.peak', this.meters.lastMeterPowerPeak);
			this.setCapability('meter_offPeak', this.meters.lastOffpeak);
			this.setCapability('meter_power.offPeak', this.meters.lastMeterPowerOffpeak);
			this.setCapability('meter_power.producedPeak', this.meters.lastMeterPowerPeakProduced);
			this.setCapability('meter_power.producedOffPeak', this.meters.lastMeterPowerOffpeakProduced);
			this.watchDogCounter = 10;
		} catch (error) {
			this.error(error);
		}
	}

}

module.exports = P1Device;
