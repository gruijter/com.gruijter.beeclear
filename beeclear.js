/*
Copyright 2020, Robin de Gruijter (gruijter@hotmail.com)

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

const http = require('http');
const https = require('https');
const qs = require('querystring');
const dns = require('dns').promises;
// const util = require('util');

// process.env.UV_THREADPOOL_SIZE = 128;	// prevent DNS Error: getaddrinfo EAI_AGAIN
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0; // prevent self signed certificate error

const discoveryHost = 'beeclear.nl';
const discoveryPath = '/mijnmeter/';
const loginPath = '/bc_login';
const logoutPath = '/bc_logout';
const rebootPath = '/bc_reboot';
// const powerOffPath = '/bc_poweroff';
const getReadingsPath = '/bc_current';
const getNetworkPath = '/bc_getNetwork'; // ?type=eth ?type=wifi
const getStatusPath = '/bc_status'; // sd card and P1 info
// const getSettingsPath = '/bc_settings';	// included in getSWVersionPath
const getSWVersionPath = '/bc_softwareVersion';
const getFWList = '/bc_firmware?type=list';

const defaultHost = 'beeclear.local';
const defaultPort = 80;
const defaultUser = 'beeclear';
const defaultPassword = 'energie';
const defaultTimeout = 4000;

class Beeclear {
	// Represents a session to a Beeclear Energy Manager P1 device.
	constructor(opts) {
		const options = opts || {};
		this.host = options.host || defaultHost;
		this.port = options.port || defaultPort;
		this.useTLS = options.useTLS || this.port === 443;
		this.timeout = options.timeout || defaultTimeout;
		this.username = options.username || defaultUser;
		this.password = options.password || defaultPassword;
		this.cookie = null;
		this.loggedIn = false;
		this.lastResponse = undefined;
	}

	/**
	* Login to Beeclear. Passing options will override any existing session settings.
	* @param {sessionOptions} [options] - configurable session options
	* @returns {Promise.<loggedIn>} The loggedIn state.
	*/
	async login(opts) {
		try {
			const options = opts || {};
			this.host = options.host || this.host;
			this.port = options.port || this.port;
			this.useTLS = options.useTLS || this.useTLS;
			this.timeout = options.timeout || this.timeout;
			this.username = options.username || this.username;
			this.password = options.password || this.password;

			// get IP address when using beeclear.local
			if (!this.host || this.host === defaultHost) {
				await this.discover();
			}

			const auth = {
				username: Buffer.from(this.username).toString('base64'),
				password: Buffer.from(this.password).toString('base64'),
			};
			const actionPath = `${loginPath}?${qs.stringify(auth)}`;
			const result = await this._makeRequest(actionPath, true);
			this.loggedIn = true;
			return Promise.resolve(result);
		} catch (error) {
			this.loggedIn = false;
			return Promise.reject(error);
		}
	}

	/**
	* End session.
	* @returns {(Promise.<loggedOut>)}
	*/
	async logout() {
		try {
			await this._makeRequest(logoutPath);
			this.loggedIn = false;
			this.cookie = null;
			return Promise.resolve(true);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Reboot device.
	* @returns {(Promise.<rebooting>)}
	*/
	async reboot() {
		try {
			await this._makeRequest(rebootPath);
			this.loggedIn = false;
			this.cookie = null;
			return Promise.resolve(true);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Discover a Beeclear device in your local network
 	* @returns {Promise.<IP address>} The local IP address.
	*/
	async discover() {
		try {
			// try local DNS lookup
			const lookup = await dns.lookup('beeclear.local')
				.catch(() => null);
			let address = lookup ? lookup.address : null;

			// try online discovery
			if (!address) {
				const postMessage = '';
				const options = {
					hostname: discoveryHost,
					port: 80,
					path: discoveryPath,
					method: 'GET',
				};
				const result = await this._makeHttpRequest(options, postMessage);
				if (result.statusCode === 200 && result.body.includes('window.location.href')) {
					// '<script language="javascript"> window.location.href = "http://10.0.0.22" </script>\n',
					[, address] = result.body.match(/"http:\/\/(.*)"/);
				}
			}

			this.host = address || this.host;
			return Promise.resolve(this.host);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the network info.
	* @returns {(Promise.<networkInfo>)}
	*/
	async getNetwork() {
		try {
			const eth = await this._makeRequest(`${getNetworkPath}?type=eth`);
			const wifi = await this._makeRequest(`${getNetworkPath}?type=wifi`);
			const networkInfo = { eth, wifi };
			return Promise.resolve(networkInfo);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the device settings.
	* @returns {(Promise.<settings>)}
	*/
	async getSettings() {
		try {
			const settings = await this._makeRequest(getSWVersionPath);
			return Promise.resolve(settings);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the SD card status.
	* @returns {(Promise.<status>)}
	*/
	async getStatus() {
		try {
			const status = await this._makeRequest(getStatusPath);
			return Promise.resolve(status);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the firmware list.
	* @returns {(Promise.<FWList>)}
	*/
	async getFirmwareList() {
		try {
			const FWList = await this._makeRequest(getFWList);
			return Promise.resolve(FWList);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the power  and gas meter readings.
	* @param {boolean} [short = true] - full or short meter readings
	* @returns {Promise<meterReadingsFull || meterReadingsShort>}
	*/
	async getMeterReadings(short) {
		try {
			const raw = await this._makeRequest(getReadingsPath)
				.catch((error) => {
					if (error.message && error.message.includes('Unexpected token')) throw Error('P1 is not connected');
					throw error;
				});
			if (!short) return Promise.resolve(raw);
			const readings = {};
			try {
				const measurePower = raw.u;
				const measurePowerProduced = raw.g;
				const powerPeak = raw.uh / 1000;
				const powerOffpeak = raw.ul / 1000;
				const powerPeakProduced = raw.gh / 1000;
				const powerOffpeakProduced = raw.gl / 1000;
				const powerTm = raw.d;
				readings.pwr = measurePower - measurePowerProduced;
				readings.net = Math.round(10000 * (powerPeak + powerOffpeak - powerPeakProduced - powerOffpeakProduced)) / 10000;
				readings.p2 = powerPeak;
				readings.p1 = powerOffpeak;
				readings.n2 = powerPeakProduced;
				readings.n1 = powerOffpeakProduced;
				readings.tm = powerTm;
			} catch (err) {
				// console.log('Error parsing power information, or no power readings available');
			}
			try {
				const gas = raw.gas[0].val / 1000;
				const gasTm = raw.gas[0].time;
				readings.gas = gas;
				readings.gtm = gasTm;
			} catch (err) {
				// console.log('Error parsing gas information, or no gas readings available');
			}
			if (!readings.tm && !readings.gtm) {
				throw Error('Error parsing meter info');
			}
			return Promise.resolve(readings);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	async _makeRequest(actionPath, force, timeout) {
		try {
			if (!this.loggedIn && !force) {
				return Promise.reject(Error('Not logged in'));
			}
			const postMessage = '';
			const headers = {
				'cache-control': 'no-cache',
				'user-agent': 'node-Beeclearp1js',
				'content-length': Buffer.byteLength(postMessage),
				connection: 'Keep-Alive',
			};
			if (this.cookie) {
				headers.cookie = this.cookie;
			}
			const options = {
				hostname: this.host,
				port: this.port,
				path: actionPath,
				headers,
				method: 'GET',
			};
			let result;
			if (this.useTLS) {
				result = await this._makeHttpsRequest(options, postMessage, timeout);
			} else {
				result = await this._makeHttpRequest(options, postMessage, timeout);
			}
			this.lastResponse = result.body;
			if (result.headers['set-cookie']) {
				this.cookie = result.headers['set-cookie'];
			}
			if (result.statusCode !== 200 && result.statusCode) {
				this.lastResponse = result.statusCode;
				throw Error(`HTTP request Failed. Status Code: ${result.statusCode}`);
			}
			const contentType = result.headers['content-type'];
			if (!/^text\/json/.test(contentType)) {
				throw Error(`Invalid content-type. Expected text/json but received ${contentType}`);
			}
			return Promise.resolve(JSON.parse(result.body));
		} catch (error) {
			return Promise.reject(error);
		}
	}

	_makeHttpRequest(options, postData, timeout) {
		return new Promise((resolve, reject) => {
			const req = http.request(options, (res) => {
				let resBody = '';
				res.on('data', (chunk) => {
					resBody += chunk;
				});
				res.once('end', () => {
					res.body = resBody;
					return resolve(res); // resolve the request
				});
			});
			req.setTimeout(timeout || this.timeout, () => {
				req.abort();
			});
			req.once('error', (e) => {
				this.lastResponse = e;	// e.g. ECONNREFUSED on wrong port or wrong IP // ECONNRESET on wrong IP
				return reject(e);
			});
			// req.write(postData);
			req.end(postData);
		});
	}

	_makeHttpsRequest(opts, postData, timeout) {
		return new Promise((resolve, reject) => {
			if (!this.httpsAgent) {
				const agentOptions = {
					rejectUnauthorized: false,
				};
				this.httpsAgent = new https.Agent(agentOptions);
			}
			const options = opts;
			options.agent = this.httpsAgent;

			const req = https.request(options, (res) => {
				let resBody = '';
				res.on('data', (chunk) => {
					resBody += chunk;
				});
				res.once('end', () => {
					res.body = resBody;
					return resolve(res); // resolve the request
				});
			});
			req.setTimeout(timeout || this.timeout, () => {
				req.abort();
			});
			req.once('error', (e) => {
				this.lastResponse = e;	// e.g. ECONNREFUSED on wrong port or wrong IP // ECONNRESET on wrong IP
				return reject(e);
			});
			// req.write(postData);
			req.end(postData);
		});
	}

}

module.exports = Beeclear;

// definitions for JSDoc

/**
* @class Beeclear
* @classdesc Class representing a session with a Beeclear P1 device.
* @param {sessionOptions} [options] - configurable session options
* @property {boolean} loggedIn - login state.

* @example // create a Beeclear P1 session, login to device, fetch meter readings
	const Beeclear = require('beeclear');

	const bc = new Beeclear();

	async function getMeterReadings() {
		try {
			await bc.login();
			const powerInfo = await bc.getMeterReadings();
			console.log(powerInfo);
		} catch (error) {
			console.log(error);
		}
	}

	getMeterReadings();
*/

/**
* @typedef sessionOptions
* @description Set of configurable options to set on the class or during login
* @property {string} [username = 'beeclear'] - The username
* @property {string} [password = 'energie'] - The password
* @property {string} [host = 'beeclear.local'] - The url or ip address of the Beeclear device.
* @property {number} [port = 80] - The port of the Beeclear P1. Defaults to 80. TLS/SSL will be used when setting port to 443.
* @property {boolean} [useTLS = false] - use TLS (HTTPS).
* @property {number} [timeout = 4000] - http(s) timeout in milliseconds. Defaults to 4000ms.
* @example // session options
{ password: 'hcfrasde',
  port: 443,
  timeout: 5000 }
*/

/**
* @typedef meterReadingsShort
* @description meterReadings is an object containing power and gas information.
* @property {number} pwr power meter total (consumption - production) in kWh. e.g. 7507.336
* @property {number} net power consumption in Watt. e.g. 3030
* @property {number} p2 P2 consumption counter (high tariff). e.g. 896.812
* @property {number} p1 P1 consumption counter (low tariff). e.g. 16110.964
* @property {number} n2 N2 production counter (high tariff). e.g. 4250.32
* @property {number} n1 N1 production counter (low tariff). e.g. 1570.936
* @property {number} tm time of retrieving info. unix-time-format. e.g. 1542575626
* @property {number} gas counter gas-meter (in m^3). e.g. 6161.243
* @property {number} gtm time of the last gas measurement. unix-time-format. e.g. 1542574800
* @example // meterReadings
{	pwr: 646,
	net: 7507.335999999999,
	p2: 5540.311,
	p1: 3161.826,
	n2: 400.407,
	n1: 794.394,
	tm: 1560178800,
	gas: 2162.69,
	gtm: 1560178800 }
*/

/*
login response;

{
    "status": 200,
    "message": "Welkom",
    "access_token": "toegang gegeven",
    "security": 0,
    "setting": {
        "landcode": "NL",
        "user": "beeclear",
        "auth": "admin",
        "metertype": false,
        "mijnmeter": true,
        "showgas": true,
        "gasUseElekTime": false,
        "dubbeltariefmeter": true,
        "levering": true,
        "testfirmware": true,
        "enableHttps": true,
        "enableMqtt": true,
        "driefaseMeting": false,
        "rawlogging": false,
        "dsmrtime": false,
        "certUse": true,
        "tarief": {
            "gas": 1.000000,
            "elekHoog": 0.260000,
            "elekLaag": 0.230000,
            "gasvast24h": 0.000000,
            "elekvast24h": 0.000000
        },
        "starttime": {
            "gas": 1434819600,
            "elek": 1434819600,
            "elekw": 1556907960
        }
    }
}

networkStatus response:
{
  eth: {
    status: 'ok',
    ip: '',
    netmask: '',
    proto: 'dhcp',
    hostname: 'beeclear',
    router: '',
    dns: '',
    status_ethernet: {
      ip: '10.0.0.22',
      netmask: '255.255.255.0',
      router: '10.0.0.1',
      dns: '10.0.0.1',
      link: 'up',
      speed: '10',
      duplex: 'half',
      mac: '64:51:7e:68:2e:9d'
    }
  },
  wifi: {
    status: 'ok',
    ip: '192.168.111.1',
    netmask: '255.255.255.0',
    proto: 'static',
    hostname: 'beeclear',
    mode: 'ap',
    ssid: 'BeeClear',
    key: 'power2you',
    encryption: 'psk2+tkip+ccmp',
    router: '',
    dns: '',
    status_info: {
      aan: 1,
      ip: '192.168.111.1',
      netmask: '255.255.255.0',
      router: '',
      dns: '',
      mode: 'AP',
      wstatus: 'up',
      signal: 'channel 1 (2412 MHz), width: 20 MHz, center1: 2412 MHz',
      ssid: 'BeeClear',
      mac: '64:51:7e:68:2e:9c'
    }
  }
}

getSettings response:
{
  info: 'ok',
  name: 'XMX5XMXABCE000021673',
  serialElec: '98108309        ',
  gas: [ { slot: 0, serial: '28011001147026511' } ],
  protocolVersion: '0',
  uptime: 90672,
  hardware: '2',
  firmware: '49.10_NL',
  timeSync: 2,
  setting: {
    landcode: 'NL',
    user: 'beeclear',
    auth: 'admin',
    metertype: true,
    mijnmeter: true,
    showgas: true,
    gasUseElekTime: false,
    dubbeltariefmeter: true,
    levering: true,
    testfirmware: false,
    enableHttps: true,
    enableMqtt: false,
    driefaseMeting: false,
    rawlogging: false,
    dsmrtime: false,
    certUse: false,
    tarief: {
      gas: 0.6,
      elekHoog: 0.19512,
      elekLaag: 0.17982,
      gasvast24h: 0,
      elekvast24h: 0
    },
    starttime: { gas: 1600866000, elek: 1600866000, elekw: 1600868110 }
  }
}

getStatus response:
{ p1: 0, sdcard: 1, sdcardFree: '99.9%', sdcardTotal: '15.47 GB' }

getFWList response:
{
  info: 'ok',
  firmware: [ { file: 'BeeClear_49.10_NL.bin', version: '49.10_NL' } ],
  firmwareNew: '49.10_NL',
  firmwareTest: '',
  current: '49.10_NL',
  setting: {
    landcode: 'NL',
    user: 'beeclear',
    auth: 'admin',
    metertype: true,
    mijnmeter: true,
    showgas: true,
    gasUseElekTime: false,
    dubbeltariefmeter: true,
    levering: true,
    testfirmware: false,
    enableHttps: true,
    enableMqtt: false,
    driefaseMeting: false,
    rawlogging: false,
    dsmrtime: false,
    certUse: false,
    tarief: {
      gas: 0.6,
      elekHoog: 0.19512,
      elekLaag: 0.17982,
      gasvast24h: 0,
      elekvast24h: 0
    },
    starttime: { gas: 1600866000, elek: 1600866000, elekw: 1600868110 }
  }
}

meter readings short response:

{
  pwr: 250,
  net: 27178.198,
  p2: 13136.563,
  p1: 21605.664,
  n2: 5515.37,
  n1: 2048.659,
  tm: 1600871427,
  gas: 7753.493,
  gtm: 1600869600
}

meter readings full response:
{
  d: 1600798993,
  ed: 1600798989,
  tariefStatus: 2,	// 2=peak
  ul: 12637314,		// usage off_peak in wH
  uh: 8553028,		// usage peak in wH
  gl: 4288455,		// production off_peak in wH
  gh: 10048153,		// production peak in wH
  verbruik0: 814,
  leveren0: 0,
  verbruik1: -1,
  leveren1: -1,
  verbruik2: -1,
  leveren2: -1,
  u: 812,	// power_measure usage
  g: 0,		// power_measure production
  gas: [ { slot: 0, val: 6399475, time: 1600797600 } ],	// val = m3 * 1000
  setting: {
    landcode: 'NL',
    user: 'beeclear',
    auth: 'admin',
    metertype: false,
    mijnmeter: true,
    showgas: true,
    gasUseElekTime: false,
    dubbeltariefmeter: true,
    levering: true,
    testfirmware: true,
    enableHttps: true,
    enableMqtt: true,
    driefaseMeting: false,
    rawlogging: false,
    dsmrtime: false,
    certUse: true,
    tarief: {
      gas: 1,
      elekHoog: 0.26,
      elekLaag: 0.23,
      gasvast24h: 0,
      elekvast24h: 0
    },
    starttime: { gas: 1434819600, elek: 1434819600, elekw: 1556907960 }
  }
}

Elektriciteit
Tijd	20:25:07 22-09-2020
Tarief	Hoog
Huidige verbruik	783 W
Huidige levering	0 W
Verbruik hoogtarief	8.553,055 kWh
Verbruik laagtarief	12.637,314 kWh
Levering hoogtarief	10.048,153 kWh
Levering laagtarief	4.288,455 kWh
Gas
Tijd	20:00:00 22-09-2020
Verbruik	6.399,475 m3

*/
