## Node package to interface directly with BeeClear Energy Monitor devices.

### It allows you to:

#### get:
* device and smart meter information
* P1 connection status and SD card status
* network and wifi information
* live energy and gas readings


#### set:
* nothing (yet)

#### do:
* discover the device in a local network
* login with device username and password
* reboot the device

### Note:
This package has been developed and tested with firmware 49.42_NL.

### Install:
If you don't have Node installed yet, get it from: [Nodejs.org](https://nodejs.org "Nodejs website").

To install the BeeClear package:
```
> npm i beeclear
```

### Test:
From the folder in which you installed the BeeClear package, just run below command. The port only needs to be set if you are not using the default port 80. TLS/SSL will be used when setting port to 443. When no host is entered, autodiscovery will be attempted. Username and password only need to be set if you are not using the defaults.
```
> npm test [host=yourDeviceIP] [port=yourHostPort] [username=beeclear] [password=energie] [useTLS=false]
```

### Quickstart:

```
// create a Beeclear session, login to device, fetch meter readings
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
```

## Detailed documentation:
[Detailed documentation](https://gruijter.github.io/beeclear.js/ "beeclear.js documentation")

