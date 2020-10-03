/* This Source Code Form is subject to the terms of the Mozilla Public
	License, v. 2.0. If a copy of the MPL was not distributed with this
	file, You can obtain one at http://mozilla.org/MPL/2.0/.

	Copyright 2020, Robin de Gruijter <gruijter@hotmail.com> */

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
// const getTestFW = '/bc_firmware?type=fetchTest';
// const getFW = '/bc_firmware?type=fetch';
// const removeFW = 'bc_firmware?type=remove&file=BeeClear_49.10_NL.bin';

// const getCertInfo = '/bc_cert';
// switch cert on: '/bc_setting?type=certUse&set=on';

const defaultHost = 'beeclear.local';
const defaultPort = 80;
const defaultUser = 'beeclear';
const defaultPassword = 'energie';
const defaultTimeout = 4000;

class Beeclear {
	// Represents a session to a Beeclear Energy Manager device.
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
			delete result.setting;
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
 	* @returns {(Promise.<address>)} The local IP address.
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
	* Get the device information and settings.
	* @returns {(Promise.<deviceInfo>)}
	*/
	async getDeviceInfo() {
		try {
			const settings = await this._makeRequest(getSWVersionPath);
			return Promise.resolve(settings);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the P1 and SD card status.
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
	* Get the online list of firmware verions.
	* @returns {(Promise.<FWList>)}
	*/
	async getFirmwareList() {
		try {
			const FWList = await this._makeRequest(getFWList);
			delete FWList.setting;
			return Promise.resolve(FWList);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	* Get the power  and gas meter readings.
	* @param {boolean} [short = false] - full or short meter readings
	* @returns {(Promise<meterReadingsFull>)}
	* @returns {(Promise.<meterReadingsShort>)}
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
* @classdesc Class representing a session with a Beeclear device.
* @param {sessionOptions} [options] - configurable session options

* @example // create a Beeclear session, login to device, fetch meter readings
	const BeeClear = require('beeclear');

	const bc = new BeeClear();

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
{ username: 'beeclear',
  password: 'energie',
  host: 'beeclear.local,
  port: 443,
  useTLS: true,
  timeout: 5000 }
*/

/**
* @typedef loggedIn
* @description meterReadingsShort is an object containing actual power and gas meter information.
* @property {number} status HTTP(S) status response code, e.g. 200
* @property {string} message login message, e.g. 'Welkom'
* @property {string} access_token 'toegang gegeven'
* @property {number} security 0
* @example // loggedIn
{
  status: 200,
  message: 'Welkom',
  access_token: 'toegang gegeven',
  security: 0
}
*/

/**
* @typedef status
* @description status is an object containing P1 connection and SD-card status.
* @property {number} p1 P1 connection state. 0 = not connected, 1 = connected.
* @property {string} sdcardFree SD card free storage space, e.g. '99.9%'
* @property {string} sdcardTotal SD card total storage space, e.g. '15.47 GB'
* @example // status
{ p1: 0, sdcard: 1, sdcardFree: '99.9%', sdcardTotal: '15.47 GB' }
*/

/**
* @typedef meterReadingsShort
* @description meterReadingsShort is an object containing actual power and gas meter information.
* @property {number} pwr power meter total (consumption - production) in kWh. e.g. 7507.336
* @property {number} net actual power consumption in Watt. e.g. 3030
* @property {number} p2 consumption counter high tariff in kWh. e.g. 896.812
* @property {number} p1 consumption counter low tariff in kWh. e.g. 16110.964
* @property {number} n2 production counter high tariff in kWh. e.g. 4250.32
* @property {number} n1 production counter low tariff in kWh. e.g. 1570.936
* @property {number} tm time of retrieving info. unix-time-format. e.g. 1542575626
* @property {number} gas gas-meter counter in m³. e.g. 6161.243
* @property {number} gtm time of the last gas measurement in unix-time-format. e.g. 1542574800
* @example // meterReadingsShort
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

/**
* @typedef meterReadingsFull
* @description meterReadingsFull is an object containing actual power and gas meter information.
* @property {number} d time of the last measurement in unix-time-format. e.g. 1600798993
* @property {number} ed time of the last electricity measurement in unix-time-format. e.g. 1600798989
* @property {number} tariefStatus 1 = off-peak (low tariff), 2 = peak (high tariff)
* @property {number} ul consumption counter low tariff in Wh. e.g. 12637314
* @property {number} uh consumption counter high tariff in Wh. e.g. 8553028
* @property {number} gl production counter low tariff in Wh. e.g. 4288455
* @property {number} gh production counter high tariff in Wh. e.g. 10048153
* @property {number} verbruik0 actual power consumption Phase 1 in Watt. -1 = not present
* @property {number} leveren0 actual power production Phase 1 in Watt. -1 = not present
* @property {number} verbruik1 actual power consumption Phase 2 in Watt. -1 = not present
* @property {number} leveren1 actual power production Phase 2 in Watt. -1 = not present
* @property {number} verbruik2 actual power consumption Phase 3 in Watt. -1 = not present
* @property {number} leveren2 actual power production Phase 3 in Watt. -1 = not present
* @property {number} u actual total power consumption in Watt. e.g. 814
* @property {number} g actual total power production in Watt
* @property {number} gas[].slot 0 for a single gas meter. 0-3 for multiple gas meters
* @property {number} gas[].val gas-meter counter in liter (1000 * m³). e.g. 6399475
* @property {number} gas[].time time of the last gas measurement in unix-time-format. e.g. 1600797600
* @example // meterReadingsFull
{
  d: 1600798993,
  ed: 1600798989,
  tariefStatus: 2,
  ul: 12637314,
  uh: 8553028,
  gl: 4288455,
  gh: 10048153,
  verbruik0: 814,
  leveren0: 0,
  verbruik1: -1,
  leveren1: -1,
  verbruik2: -1,
  leveren2: -1,
  u: 812,
  g: 0,
  gas: [ { slot: 0, val: 6399475, time: 1600797600 } ]
}
*/

/**
* @typedef deviceInfo
* @description settings properties of the BeeClear device
* @property {string} info - 'ok'
* @property {string} name - Type ID of the smart meter, e.g. 'KFM5KAIFA-METER'
* @property {string} serialElec - serial number of the electricity meter, e.g. '98109215        '
* @property {array} gas slot: 0-3 for multiple gas meters. serial: serial number of the gas meter, e.g. '28011001147028281'
* @property {string} protocolVersion - DSMR protocol version of the smart meter. e.g. '42', or '0' for unknown
* @property {number} uptime - time since last BeeClear device startup in seconds, e.g. 1018445
* @property {string} hardware - BeeClear device hardware version. e.g. '2'
* @property {string} firmware - BeeClear device software version. e.g. '49.10_NL'
* @property {number} timeSync - 2 = NTP
* @property {string} setting.landcode - Country code 'NL' or 'BE'
* @property {string} setting.user - logged in user name
* @property {string} setting.auth - logged in user role. 'admin' or 'user'
* @property {boolean} setting.metertype - is DSMR3 meter
* @property {boolean} setting.mijnmeter - local IP is published to beeclear.nl/mijnmeter
* @property {boolean} setting.showgas - gas meter via P1 is enabled
* @property {boolean} setting.gasUseElekTime - use elektricity timestamp to store gas data
* @property {boolean} setting.dubbeltariefmeter - use dual tariff meter
* @property {boolean} setting.levering - use production meter
* @property {boolean} setting.testfirmware - use test fimrware during updates
* @property {boolean} setting.enableHttps - HTTPS port 443 is enabled
* @property {boolean} setting.enableMqtt - MQTT interface is enabled
* @property {boolean} setting.driefaseMeting - 3 phase meter is enabled
* @property {boolean} setting.rawlogging - raw logging is enabled
* @property {boolean} setting.dsmrtime - DSMR time is enabled
* @property {boolean} setting.certUse - custom certificate is enabled
* @property {boolean} setting.tarief - tariffs used to calculate energy cost
* @property {boolean} setting.starttime - time of the oldest measurement stored on the SD-card. In unix-time-format. e.g. 1600866000
* @example // deviceInfo
{
  info: 'ok',
  name: 'KFM5KAIFA-METER',
  serialElec: '98109215        ',
  gas: [ { slot: 0, serial: '28011001147028281' } ],
  protocolVersion: '42',
  uptime: 1018445,
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
*/

/**
* @typedef networkInfo
* @description networkInfo is an object containing information of the Ethernet and WiFi interfaces.
* @property {string} status 'ok'
* @property {string} ip IP address of the BeeClear device on the network interface, e.g. '192.168.200.201'.
* @property {string} netmask e.g. '255.255.255.0'
* @property {string} proto obtain IP address. 'static', 'dhcp' or 'off'
* @property {string} hostname name of the BeeClear device in the local network, e.g. 'beeclear'
* @property {string} router router address used by the BeeCler device, e.g. '192.168.200.1'
* @property {string} dns dns server address used by the BeeCler device
* @property {string} link ethernet link state, e.g. 'up' or 'lowerlayerdown'
* @property {string} speed ethernet speed, e.g. '10'
* @property {string} duplex ethernet duplex, e.g. 'half'
* @property {string} mac MAC address of the BeeClear network interface, e.g. '64:51:7e:63:2b:a5'
* @property {string} mode WiFi mode. 'ap' = access point, 'sta' = client station
* @property {string} ssid WiFi SSID, e.g. 'BeeClear'
* @property {string} key WiFi password
* @property {string} encryption WiFi encryption mode, e.g. 'psk2+tkip+ccmp'
* @property {number} aan WiFi radio is on
* @property {string} aan WiFi wireless link state. e.g. 'down' or 'up'
* @property {string} signal WiFi channel info, e.g. 'channel 3 (2422 MHz), width: 20 MHz, center1: 2422 MHz',
* @example // networkInfo
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
      ip: '192.168.200.201',
      netmask: '255.255.255.0',
      router: '192.168.200.1',
      dns: '192.168.200.1',
      link: 'up',
      speed: '10',
      duplex: 'half',
      mac: '64:51:7e:63:2b:a5'
    }
  },
  wifi: {
    status: 'ok',
    ip: '192.168.111.1',
    netmask: '255.255.255.0',
    proto: 'off',
    hostname: 'bcprod',
    mode: 'ap',
    ssid: 'BeeClear',
    key: 'power2you',
    encryption: 'psk2+tkip+ccmp',
    router: '',
    dns: '',
    status_info: {
      aan: 1,
      ip: '',
      netmask: '',
      router: '',
      dns: '',
      mode: 'sta',
      wstatus: 'down',
      signal: '',
      ssid: '',
      mac: '64:51:7e:63:2b:a4'
    }
  }
}
*/

/**
* @typedef FWList
* @description FWList is an object containing current and downloadable firmware levels.
* @property {string} info 'ok'
* @property {string} current installed firmware level, e.g. '49.10_NL'
* @property {string} firmwareNew new available stable firmware level, e.g. '49.10_NL'
* @property {string} firmwareTest new available unstable firmware level, e.g. 'soult_NL'
* @property {string} firmware[].file filename of downloaded firmware file, e.g. 'BeeClear_49.10_NL.bin'
* @property {string} firmware[].version version of downloaded firmware file, '49.10_NL'
* @example // FWList
{
  info: 'ok',
  firmware: [
    { file: 'BeeClear_49.10_NL.bin', version: '49.10_NL' }
  ],
  firmwareNew: '49.10_NL',
  firmwareTest: 'soult_NL',
  current: '49.10_NL'
}
*/
