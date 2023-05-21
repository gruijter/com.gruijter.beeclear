# BeeClear Energy manager #

Homey app to interface DSMR P1 smart meters via the BeeClear Enery Manager.

A local connection over IP is used, so there is no need for an internet connection.

The app logs and provides flow cards for the following data:
- Actual power usage/production (W, 10s interval)
- Totalized power meter (kWh)
- All individual power meters (kWh)
- Recent gas usage (m3, of the previous hour)
- Gas meter (m3)
- Tariff change (off-peak, true or false)

The power is totalized for consumed and produced power, during off-peak and
peak hours. Production to the powergrid is displayed as negative watts.

To setup go to "Devices" and add the device. Provide the username and password.
The polling interval can be changed in the device settings.

##### Support #####
Check the [forum]

============================================================================

Version changelog: [changelog.txt]

[forum]: https://community.athom.com/t/80608
[changelog.txt]: https://github.com/gruijter/com.gruijter.beeclear/blob/master/changelog.txt
