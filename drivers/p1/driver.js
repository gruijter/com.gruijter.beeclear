/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable prefer-destructuring */
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
const Beeclear = require('beeclear');
const Ledring = require('../../ledring');

class Driver extends Homey.Driver {

  onInit() {
    this.log('entering driver');
    this.ledring = new Ledring({ screensaver: 'beeclear_power', homey: this.homey });
  }

  async onPair(session) {
    session.setHandler('validate', async (dat) => {
      try {
        this.log('save button pressed in frontend');
        const data = dat;
        let host = data.host.split(':')[0];
        host = (host === '') ? undefined : host;
        let port = Number(data.host.split(':')[1]);
        port = Number.isNaN(port) ? 0 : port;
        port = (!port && data.useTLS) ? 443 : port;
        port = port || 80;
        const options = {
          host,
          port,
          username: (data.username === '') ? null : data.username,
          password: (data.password === '') ? null : data.password,
          useTLS: data.useTLS,
        };
        const bc = new Beeclear(options);
        await bc.login();
        const { eth } = await bc.getNetwork();

        // compile selected and available capabilities
        const { setting } = await bc.getDeviceInfo();
        data.includeGas = setting.showgas;
        data.includeOffPeak = setting.dubbeltariefmeter;
        data.include3phase = setting.driefaseMeting;
        data.includeProduction = setting.levering;
        const p1Readings = await bc.getMeterReadings(true);
        const capabilities = [];
        if (data.includeGas) {
          capabilities.push('measure_gas');
        }
        if (data.includeOffPeak) {
          capabilities.push('meter_offPeak');
        }
        capabilities.push('measure_power'); // always include measure_power
        if (p1Readings && Number.isFinite(p1Readings.l1)) { //  has current and power per phase
          capabilities.push('measure_power.l1');
          if (data.include3phase) {
            capabilities.push('measure_power.l2');
            capabilities.push('measure_power.l3');
          }
        }
        if (p1Readings && Number.isFinite(p1Readings.v1)) { // has voltage and current per phase
          capabilities.push('measure_current.l1');
          if (data.include3phase) {
            capabilities.push('measure_current.l2');
            capabilities.push('measure_current.l3');
          }
          capabilities.push('measure_voltage.l1');
          if (data.include3phase) {
            capabilities.push('measure_voltage.l2');
            capabilities.push('measure_voltage.l3');
          }
        }
        if (data.includeOffPeak) {
          capabilities.push('meter_power.peak');
          capabilities.push('meter_power.offPeak');
        }
        if (data.includeProduction) {
          capabilities.push('meter_power.producedPeak');
        }
        if (data.includeProduction && data.includeOffPeak) {
          capabilities.push('meter_power.producedOffPeak');
        }
        capabilities.push('meter_power'); // always include meter_power
        capabilities.push('meter_power.imported'); // always include meter_power.imported
        capabilities.push('meter_power.exported'); // always include meter_power.exported
        if (data.includeGas) {
          capabilities.push('meter_gas');
        }

        const device = {
          name: 'Beeclear',
          data: { id: eth.status_ethernet.mac },
          settings: {
            mac: eth.status_ethernet.mac,
            host,
            port,
            username: bc.username,
            password: bc.password,
            useTLS: bc.useTLS,
            ledring_usage_limit: 3000,
            ledring_production_limit: 3000,
            include_gas: setting.showgas,
            include_off_peak: setting.dubbeltariefmeter,
            include3phase: setting.driefaseMeting,
            include_production: setting.levering,
          },
          capabilities,
        };
        return JSON.stringify(device); // report success to frontend
      } catch (error) {
        this.error('Pair error', error);
        if (error.code === 'EHOSTUNREACH') {
          throw Error('Incorrect IP address');
        } else throw Error('No device found', error.message);
      }
    });
  }

}

module.exports = Driver;
