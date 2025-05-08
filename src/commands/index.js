const { registerPollCommands } = require('./pollCommands');
const { registerHelpCommands } = require('./helpCommands');
const { registerAdminCommands } = require('./adminCommands');
const logger = require('../utils/logger');

/**
 * Register all bot commands
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 */
const registerCommands = (bot) => {
  logger.info('Registering bot commands');
  
  // Register each command group
  registerPollCommands(bot);
  registerHelpCommands(bot);
  registerAdminCommands(bot);
  
  // Set global command list for Telegram menu
  bot.telegram.setMyCommands([
    { command: 'help', description: 'Show help information' },
    { command: 'createpoll', description: 'Create a new poll (interactive wizard)' },
    { command: 'checkvoters', description: 'Check who voted for a specific option' }
  ]).catch(err => {
    logger.error('Failed to set bot commands', err);
  });
  
  // Fallback for unhandled messages in private chats
  bot.on('message', async (ctx) => {
    if (ctx.chat.type === 'private') {
      await ctx.reply(
        'I didn\'t understand that command. Try /help to see available commands.'
      );
    }
  });
};

module.exports = {
  registerCommands
};