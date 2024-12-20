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

const Homey = require('homey');

class MyApp extends Homey.App {

  onInit() {
    // register some listeners
    process.on('unhandledRejection', (error) => {
      this.error('unhandledRejection! ', error);
    });
    process.on('uncaughtException', (error) => {
      this.error('uncaughtException! ', error);
    });
    this.homey
      .on('unload', () => {
        this.log('app unload called');
      })
      .on('memwarn', () => {
        this.log('memwarn!');
      });

    this.registerFlowListeners();

    this.log('Beeclear app is running!');
  }

  // ============================================================
  // logfile stuff for frontend API here
  deleteLogs() {
    return this.logger.deleteLogs();
  }

  getLogs() {
    return this.logger.logArray;
  }

  registerFlowListeners() {
    // condition cards
    const offPeakCondition = this.homey.flow.getConditionCard('is_offPeak');
    offPeakCondition.registerRunListener((args) => args.device.getCapabilityValue('meter_offPeak'));

    // trigger cards
    this.triggerTariffChanged = (device, tokens, state) => {
      const tariffChanged = this.homey.flow.getDeviceTriggerCard('tariff_changed');
      tariffChanged
        .trigger(device, tokens, state)
        // .then(console.log(device.getName(), tokens))
        .catch(this.error);
    };
    this.triggerPowerChanged = (device, tokens, state) => {
      const powerChanged = this.homey.flow.getDeviceTriggerCard('power_changed');
      powerChanged
        .trigger(device, tokens, state)
        // .then(console.log(device.getName(), tokens))
        .catch(this.error);
    };
  }

}

module.exports = MyApp;
