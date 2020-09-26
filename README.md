# BeeClear Energy maanger #

Homey app to interface DSMR P1 smart meters via a BeeClear Enery Manager.

A local connection over IP is used, so there is no need for an internet connection.

The app logs and provides flow cards for the following data:
- Actual power usage/production (W, 10s interval)
- Totalized power meter (kWh)
- All individual power meters (kWh)
- Recent gas usage (m3, of the previous hour)
- Gas meter (m3)
- Tariff change (off-peak, true or false)

Ledring screensaver:
- See how much energy you are using or producing just by looking at your Homey!
- Is the wash-dryer ready? Am I now producing power to the grid?

The power is totalized for consumed and produced power, during off-peak and
peak hours. Production to the powergrid is displayed as negative watts.
Only changed values are logged.

To setup go to "Devices" and add the device. Provide the username and password.
The polling interval can be changed in the device settings.

##### Donate: #####
If you like the app you can show your appreciation by posting it in the [forum],
and if you really like it you can buy me a beer.

===============================================================================

Version changelog: [changelog.txt]

[forum]: https://community.athom.com/t/34980
[changelog.txt]: https://github.com/gruijter/com.gruijter.beeclear/blob/master/changelog.txt
