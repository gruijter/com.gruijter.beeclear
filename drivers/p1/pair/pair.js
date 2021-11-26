/* eslint-disable prefer-destructuring */
/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

const homeyIsV2 = typeof Homey.showLoadingOverlay === 'function';
Homey.setTitle(__('pair.title'));

if (!homeyIsV2) {
	Homey.showLoadingOverlay = () => {
		$('#discover').prop('disabled', true);
		$('#runTest').prop('disabled', true);
	};
	Homey.hideLoadingOverlay = () => {
		$('#discover').prop('disabled', false);
		$('#runTest').prop('disabled', false);
	};
}

function testSettings() {
	// variables

	const data = {
		host: $('#host').val(),
		useTLS: $('#useTLS').prop('checked'),
		username: $('#username').val(),
		password: $('#password').val(),
	};
	// Continue to back-end, pass along data
	Homey.showLoadingOverlay();
	Homey.emit('validate', data, (error, result) => {
		if (error) {
			Homey.hideLoadingOverlay();
			Homey.alert(error.message, 'error');
		} else {
			const device = JSON.parse(result);
			Homey.createDevice(device, (err, res) => {
				Homey.hideLoadingOverlay();
				if (err) { Homey.alert(err, 'error'); return; }
				Homey.alert(`${__('pair.success')} ${result}`, 'info');
				Homey.done();
				// setTimeout(() => {
				// 	Homey.done();
				// }, 1000);
			});
		}
	});

}
