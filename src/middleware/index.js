const { chatTypeMiddleware } = require('./chatTypeMiddleware');
const { userMiddleware } = require('./userMiddleware');
const logger = require('../utils/logger');
const { i18nMiddleware } = require('../utils/i18n');

/**
 * Set up all middleware for the bot
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 */
const setupMiddleware = (bot) => {
  // Log all incoming updates
  bot.use(async (ctx, next) => {
    const start = Date.now();
    const updateType = ctx.updateType || '';
    const updateSubType = (ctx.updateSubTypes && ctx.updateSubTypes.length > 0) ? ctx.updateSubTypes[0] : '';
    
    logger.debug(
      `Processing update [${ctx.update.update_id}]: ${updateType}/${updateSubType}`, 
      { 
        from: ctx.from, 
        chat: ctx.chat,
        updateType,
        updateSubType
      }
    );
    
    await next();
    
    const ms = Date.now() - start;
    logger.debug(`Response time for [${ctx.update.update_id}]: ${ms}ms`);
  });
  
  // Add chat type context
  bot.use(chatTypeMiddleware);
  
  // Add user data to context
  bot.use(userMiddleware);
  
  // Add internationalization
  bot.use(i18nMiddleware);
  
  // Handle bot mention in groups
  bot.mention(new RegExp(bot.botInfo?.username || '', 'i'), async (ctx, next) => {
    logger.debug('Bot was mentioned', { text: ctx.message.text });
    await next();
  });
};

module.exports = {
  setupMiddleware
};