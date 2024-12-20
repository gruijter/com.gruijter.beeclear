/* eslint-disable no-await-in-loop */
/*
Copyright 2020 - 2023, Robin de Gruijter (gruijter@hotmail.com)

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
        reversed: settings.reversed,
      };
      this.bc = new Beeclear(options);

      // check for version migration or capability change
      if (!this.migrated) await this.migrate();
      await this.setAvailable().catch(this.error);

      // start polling device for info
      this.startPolling(settings.pollingInterval);
    } catch (error) {
      this.error(error);
      this.restartDevice(10 * 60 * 1000).catch((error) => this.error(error));
    }
  }

  startPolling(interval) {
    this.homey.clearInterval(this.intervalIdDevicePoll);
    this.log(`start polling ${this.getName()} @${interval} seconds interval`);
    this.intervalIdDevicePoll = this.homey.setInterval(() => {
      this.doPoll().catch((error) => this.error(error));
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

  async migrate() {
    try {
      this.log(`checking migration for ${this.getName()}`);
      if (!this.bc.loggedIn) await this.bc.login();
      const settings = this.getSettings();

      if (!settings.level || (settings.level < '3')) {
        const { setting } = await this.bc.getDeviceInfo();
        settings.include_gas = setting.showgas;
        settings.include_off_peak = setting.dubbeltariefmeter;
        settings.include3phase = setting.driefaseMeting;
        settings.include_production = setting.levering;
        await this.setSettings(settings);
      }

      // compile selected and available capabilities
      const p1Readings = await this.bc.getMeterReadings(true);
      const capabilities = [];
      if (settings.include_gas) {
        capabilities.push('measure_gas');
      }
      if (settings.include_off_peak) {
        capabilities.push('meter_offPeak');
      }
      capabilities.push('measure_power'); // always include measure_power
      if (p1Readings && Number.isFinite(p1Readings.l1)) { //  has current and power per phase
        capabilities.push('measure_power.l1');
        if (settings.include3phase) {
          capabilities.push('measure_power.l2');
          capabilities.push('measure_power.l3');
        }
      }
      if (p1Readings && Number.isFinite(p1Readings.v1)) { // has voltage and current per phase
        capabilities.push('measure_current.l1');
        if (settings.include3phase) {
          capabilities.push('measure_current.l2');
          capabilities.push('measure_current.l3');
        }
        capabilities.push('measure_voltage.l1');
        if (settings.include3phase) {
          capabilities.push('measure_voltage.l2');
          capabilities.push('measure_voltage.l3');
        }
      }
      if (settings.include_off_peak) {
        capabilities.push('meter_power.peak');
        capabilities.push('meter_power.offPeak');
      }
      if (settings.include_production) {
        capabilities.push('meter_power.producedPeak');
      }
      if (settings.include_production && settings.include_off_peak) {
        capabilities.push('meter_power.producedOffPeak');
      }
      capabilities.push('meter_power'); // always include meter_power
      capabilities.push('meter_power.imported'); // always include meter_power.imported
      capabilities.push('meter_power.exported'); // always include meter_power.exported
      if (settings.include_gas) {
        capabilities.push('meter_gas');
      }

      // store the capability states before migration
      const sym = Object.getOwnPropertySymbols(this).find((s) => String(s) === 'Symbol(state)');
      const state = this[sym];
      // check and repair incorrect capability(order)
      const correctCaps = capabilities;
      for (let index = 0; index < correctCaps.length; index += 1) {
        const caps = this.getCapabilities();
        const newCap = correctCaps[index];
        if (caps[index] !== newCap) {
          this.setUnavailable('Device is migrating. Please wait!');
          // remove all caps from here
          for (let i = index; i < caps.length; i += 1) {
            this.log(`removing capability ${caps[i]} for ${this.getName()}`);
            await this.removeCapability(caps[i]).catch(this.error);
            await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
          }
          // add the new cap
          this.log(`adding capability ${newCap} for ${this.getName()}`);
          await this.addCapability(newCap).catch(this.error);
          // restore capability state
          if (state[newCap] !== undefined) this.log(`${this.getName()} restoring value ${newCap} to ${state[newCap]}`);
          else this.log(`${this.getName()} no value to restore for new capability ${newCap}, ${state[newCap]}!`);
          await this.setCapability(newCap, state[newCap]);
          await setTimeoutPromise(2 * 1000); // wait a bit for Homey to settle
        }
      }

      // set new migrate level
      this.setSettings({ level: this.homey.app.manifest.version }).catch(this.error);
      this.migrated = true;
      return Promise.resolve(this.migrated);
    } catch (error) {
      this.error('Migration failed', error);
      return Promise.reject(error);
    }
  }

  // this method is called when the user has changed the device's settings in Homey.
  async onSettings({ newSettings }) { // , oldSettings, changedKeys) {
    this.log(`${this.getName()} device settings changed`);
    this.log(newSettings);
    this.migrated = false;
    this.restartDevice(2000).catch((error) => this.error(error));
    return Promise.resolve(true);
  }

  async doPoll() {
    try {
      if (this.watchDogCounter <= 0) {
        // restart the app here
        this.log('watchdog triggered, restarting device now');
        this.restartDevice(60000).catch((error) => this.error(error));
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
      this.setAvailable().catch((error) => this.error(error));
      await this.handleNewReadings(readings);
      this.watchDogCounter = 10;
    } catch (error) {
      this.setUnavailable(error.message).catch((error) => this.error(error));
      this.watchDogCounter -= 1;
      this.error('Poll error', error.message);
    }
  }

  initMeters() {
    this.lastMeters = {
      measureGas: 0, // 'measureGas' (m3)
      meterGas: null, // 'meterGas' (m3)
      meterGasTm: 0, // timestamp of gas meter reading, e.g. 1514394325
      measurePower: 0, // 'measurePower' (W)
      measurePowerAvg: 0, // '2 minute average measurePower' (kWh)
      meterPower: null, // 'meterPower' (kWh)
      meterPowerPeak: null, // 'meterPower_peak' (kWh)
      meterPowerOffPeak: null, // 'meterPower_offpeak' (kWh)
      meterPowerPeakProduced: null, // 'meterPower_peak_produced' (kWh)
      meterPowerOffPeakProduced: null, // 'meterPower_offpeak_produced' (kWh)
      meterPowerTm: null, // timestamp epoch, e.g. 1514394325
      meterPowerInterval: null, // 'meterPower' at last interval (kWh)
      meterPowerIntervalTm: null, // timestamp epoch, e.g. 1514394325
      offPeak: null, // 'meterPower_offpeak' (true/false)
    };
  }

  async setCapability(capability, value) {
    if (this.hasCapability(capability) && value !== undefined) {
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
      await this.setCapability('meter_power.imported', meters.meterPowerImported);
      await this.setCapability('meter_power.exported', meters.meterPowerExported);
      await this.setCapability('measure_gas', meters.measureGas);
      await this.setCapability('meter_gas', meters.meterGas);
      await this.setCapability('meter_power.peak', meters.meterPowerPeak);
      await this.setCapability('meter_power.offPeak', meters.meterPowerOffPeak);
      await this.setCapability('meter_power.producedPeak', meters.meterPowerPeakProduced);
      await this.setCapability('meter_power.producedOffPeak', meters.meterPowerOffPeakProduced);
      await this.setCapability('measure_power.l1', meters.l1);
      await this.setCapability('measure_power.l2', meters.l2);
      await this.setCapability('measure_power.l3', meters.l3);
      await this.setCapability('measure_current.l1', meters.i1);
      await this.setCapability('measure_current.l2', meters.i2);
      await this.setCapability('measure_current.l3', meters.i3);
      await this.setCapability('measure_voltage.l1', meters.v1);
      await this.setCapability('measure_voltage.l2', meters.v2);
      await this.setCapability('measure_voltage.l3', meters.v3);
    } catch (error) {
      this.error(error);
    }
  }

  isValidReading(readings) {
    let validReading = true;
    if (this.lastMeters.meterPowerIntervalTm === null) { // first reading after init
      return validReading; // We have to assume that the first reading after init is a valid reading :(
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
    if ((gtm !== 0) && (Math.abs(gtm - tm) > 45000)) { // > 12 hrs difference
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
        const passedHours = (meterGasTm - this.lastMeters.meterGasTm) / 3600; // timestamp is in seconds
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
      const meterPowerImported = meterPowerOffPeak + meterPowerPeak;
      const meterPowerExported = meterPowerOffPeakProduced + meterPowerPeakProduced;
      let { offPeak } = this.lastMeters;
      if ((this.lastMeters.meterPowerTm !== null) && ((meterPower - this.lastMeters.meterPower) !== 0)) {
        offPeak = ((meterPowerOffPeakProduced - this.lastMeters.meterPowerOffPeakProduced) > 0
          || (meterPowerOffPeak - this.lastMeters.meterPowerOffPeak) > 0);
      }
      // measurePowerAvg 2 minutes average based on cumulative meters
      let { meterPowerInterval, meterPowerIntervalTm } = this.lastMeters;
      if (this.lastMeters.meterPowerIntervalTm === null) { // first reading after init
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
      const tariffChanged = (this.lastMeters.offPeak !== null) && (this.lastMeters.offPeak !== undefined)
        && (offPeak !== this.getCapabilityValue('meter_offPeak'));
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
        meterPowerImported,
        meterPowerExported,
        meterPowerPeak,
        meterPowerOffPeak,
        meterPowerPeakProduced,
        meterPowerOffPeakProduced,
        meterPowerTm,
        meterPowerInterval,
        meterPowerIntervalTm,
        offPeak,
        l1: readings.l1,
        l2: readings.l2,
        l3: readings.l3,
        v1: readings.v1,
        v2: readings.v2,
        v3: readings.v3,
        i1: readings.i1,
        i2: readings.i2,
        i3: readings.i3,
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
    } catch (error) {
      this.error(error);
    }
  }

}

module.exports = BeeclearDevice;
