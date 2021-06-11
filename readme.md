# Starling Calendar Feed

This will create a calendar feed of your [Starling](https://www.starlingbank.com/) Standing Orders and Direct Debits using the [offical API](https://developer.starlingbank.com/docs).

## Setup

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

Pass your [personal access token](https://developer.starlingbank.com/docs#developing-applications-temp) as a query string `?personalToken`

### Timezone

If using Heroku, you can set your timezone using [Config Vars](https://devcenter.heroku.com/articles/config-vars) e.g.,

```
TZ=Europe/London
```