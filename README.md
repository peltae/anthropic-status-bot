# anthropic-status-bot

discord bot that monitors anthropic's status page and provides real-time updates.

## features

- real-time status monitoring with in-place updates
- live status dashboard
- incident notifications
- component status tracking

## setup

1. clone and install
```bash
git clone https://github.com/peltae/anthropic-status-bot.git
cd anthropic-status-bot
npm install
```

2. configure
```bash
# create .env file with:
DISCORD_TOKEN=your_bot_token
DISCORD_CHANNEL_ID=your_channel_id
CHECK_INTERVAL=5
LOG_LEVEL=info
```

3. run
```bash
npm start
```

## license

this project is licensed under the [mit license](LICENSE)
