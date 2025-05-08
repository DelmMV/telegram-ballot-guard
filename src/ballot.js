require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const mongoose = require('mongoose');
const { connectDB } = require('./utils/db');
const logger = require('./utils/logger');
const { registerCommands } = require('./commands');
const { setupMiddleware } = require('./middleware');
const { setupScenes } = require('./scenes');
const { setupPollingService } = require('./utils/pollingService');

// Initialize bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Enable update types that aren't received by default
bot.telegram.getUpdates({
  allowed_updates: ['message', 'callback_query', 'poll', 'poll_answer', 'inline_query']
});

// Set up session middleware
bot.use(session());

// Connect to MongoDB
(async () => {
  try {
    await connectDB();
    logger.info('Connected to MongoDB');
    
    // Setup bot middleware
    setupMiddleware(bot);
    
    // Setup scenes
    setupScenes(bot);
    
    // Register all commands
    registerCommands(bot);
    
    // Setup webhook if URL is provided
    if (process.env.WEBHOOK_URL) {
      logger.info(`Setting webhook to ${process.env.WEBHOOK_URL}`);
      await bot.telegram.setWebhook(process.env.WEBHOOK_URL);
    }
    
    // Error handling
    bot.catch((err, ctx) => {
      const updateType = ctx.updateType || 'unknown';
      const chat = ctx.chat ? `in chat ${ctx.chat.id}` : 'in unknown chat';
      const from = ctx.from ? `from user ${ctx.from.id}` : 'from unknown user';
      
      logger.error(`Error for ${updateType} ${chat} ${from}`, err);
      
      try {
        // Only reply if we have a chat to reply to
        if (ctx.chat) {
          // Use localized error message if i18n is available
          const errorMessage = ctx.i18n ? ctx.i18n.t('common.error') : 'An error occurred. Please try again later.';
          ctx.reply(errorMessage);
        }
      } catch (replyError) {
        logger.error('Failed to send error message to user:', replyError);
      }
    });
    
    // Start bot
    await bot.launch();
    logger.info('Bot started successfully');
    
    // Start polling service for tracked polls
    setupPollingService(bot);
    logger.info('Poll tracking service started');
    
    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (error) {
    logger.error('Failed to start the application:', error);
    process.exit(1);
  }
})();