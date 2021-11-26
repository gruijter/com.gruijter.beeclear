/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable prefer-destructuring */
/*
Copyright 2020 - 2021, Robin de Gruijter (gruijter@hotmail.com)

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
const Ledring = require('../../ledring.js');

class Driver extends Homey.Driver {

	onInit() {
		this.log('entering driver');
		this.ledring = new Ledring({ screensaver: 'beeclear_power', homey: this.homey });
	}

	async onPair(session) {
		session.setHandler('validate', async (data) => {
			try {
				this.log('save button pressed in frontend');
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
				const { setting } = await bc.getDeviceInfo();
				const { eth } = await bc.getNetwork();

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
					},
					capabilities: [
						'measure_power',
						'meter_power',
						// 'measure_gas',
						// 'meter_gas',
						// 'meter_offPeak',
						// 'meter_power.peak',
						// 'meter_power.offPeak',
						// 'meter_power.producedPeak',
						// 'meter_power.producedOffPeak',
					],
				};
				if (setting.dubbeltariefmeter) {
					device.capabilities.push('meter_offPeak');
					device.capabilities.push('meter_power.peak');
					device.capabilities.push('meter_power.offPeak');
				}
				if (setting.levering) {
					device.capabilities.push('meter_power.producedPeak');
				}
				if (setting.dubbeltariefmeter && setting.levering) {
					device.capabilities.push('meter_power.producedOffPeak');
				}
				if (setting.showgas) {
					device.capabilities.push('measure_gas');
					device.capabilities.push('meter_gas');
				}
				return JSON.stringify(device); // report success to frontend
			}	catch (error) {
				this.error('Pair error', error);
				if (error.code === 'EHOSTUNREACH') {
					throw Error('Incorrect IP address');
				} else throw Error('No device found', error.message);
			}
		});
	}

}

module.exports = Driver;
