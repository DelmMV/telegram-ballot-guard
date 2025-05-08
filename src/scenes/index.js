const { Scenes } = require('telegraf');
const createPollScene = require('./createPollScene');
const compactCreatePollScene = require('./compactCreatePollScene');
const checkVotersScene = require('./checkVotersScene');
const Poll = require('../models/Poll');
const logger = require('../utils/logger');

/**
 * Setup and register all bot scenes
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 */
const setupScenes = (bot) => {
  try {
    logger.info('Setting up scenes manager');
    
    // Create scene instances
    const pollWizard = createPollScene();
    const compactPollWizard = compactCreatePollScene();
    const votersWizard = checkVotersScene();
    
    // Create stage with all scenes and configure session ttl
    const stage = new Scenes.Stage([pollWizard, compactPollWizard, votersWizard], {
      ttl: 3600 // Session TTL in seconds (1 hour)
    });
    
    // Register stage middleware
    // Use session middleware to ensure data persistence between scene steps
    bot.use((ctx, next) => {
      // Initialize session if needed
      ctx.session = ctx.session || {};
      // Ensure scenes data persists
      ctx.session.__scenes = ctx.session.__scenes || { state: {} };
      return next();
    });
    
    bot.use(stage.middleware());
    
    // Command to enter poll creation scene
    bot.command('createpoll', async (ctx) => {
      const { t } = ctx.i18n;
      
      // Only allow in groups
      if (!ctx.isAnyGroup) {
        return ctx.reply(t('poll.groupOnly'));
      }
      
      logger.debug(`User ${ctx.from.id} starting poll creation wizard`);
      
      // Store command message ID in scene state for later cleanup
      const commandMessageId = ctx.message.message_id;
      
      // Always use compact scene for better UX
      return ctx.scene.enter('compact-create-poll', { commandMessageId });
    });
    
    // Command to enter check voters scene
    bot.command('checkvoters', async (ctx) => {
      const { t } = ctx.i18n;
      
      // Check if this is a private chat
      if (!ctx.isAnyGroup) {
        // In private chat, try to find user's recent polls
        try {
          // Safely get user polls with error handling
          const userPolls = await Poll.getUserPolls(ctx.from.id, true, 10) || [];
          
          if (!userPolls || userPolls.length === 0) {
            return ctx.reply(t('poll.noUserPolls') || 'You have no active polls. Create a poll in a group first or use /checkvoters <group_id> [message_id]');
          }
          
          logger.debug(`User ${ctx.from.id} starting check voters wizard from private chat with ${userPolls.length} polls`);
          
          // If user has polls, enter the scene with them
          try {
            // Safely map polls with error handling
            const mappedPolls = Array.isArray(userPolls) ? userPolls.map(p => ({
              id: p._id ? p._id.toString() : null,
              chatId: p.chatId || null,
              messageId: p.messageId || null,
              title: p.title || "Untitled Poll",
              isTracked: !!p.isTracked
            })).filter(p => p.id && p.messageId) : [];

            if (mappedPolls.length === 0) {
              return ctx.reply(t('poll.noUserPolls') || 'You have no active polls. Create a poll in a group first or use /checkvoters <group_id> [message_id]');
            }
            
            return ctx.scene.enter('check-voters', { 
              commandMessageId: ctx.message.message_id,
              userPolls: mappedPolls,
              fromPrivate: true
            });
          } catch (mappingError) {
            logger.error('Error mapping user polls:', mappingError);
            return ctx.reply(t('poll.errorProcessingPolls') || 'Error processing your polls. Please try again later.');
          }
        } catch (error) {
          logger.error('Error fetching user polls:', error);
          
          // Fallback to manual group ID input
          const args = ctx.message.text.split(/\s+/).slice(1);
          if (args.length === 0) {
            return ctx.reply(t('poll.privateCheckHelp') || 'To check poll in private chat, use format: /checkvoters <group_id> [message_id]');
          }
          
          // Extract groupId from args
          const groupId = parseInt(args[0], 10);
          if (isNaN(groupId)) {
            return ctx.reply(t('poll.invalidGroupId') || 'Invalid group ID. Please provide a valid group ID.');
          }
          
          // Check if message_id is provided
          let messageId = null;
          if (args.length > 1 && /^\d+$/.test(args[1])) {
            messageId = parseInt(args[1], 10);
          }
          
          logger.debug(`User ${ctx.from.id} starting check voters wizard from private chat for group ${groupId}`);
          
          // Store command message ID, group ID, and message ID in scene state
          return ctx.scene.enter('check-voters', { 
            commandMessageId: ctx.message.message_id,
            groupId,
            messageId,
            fromPrivate: true
          });
        }
      }
      
      // In group chat - standard behavior
      logger.debug(`User ${ctx.from.id} starting check voters wizard`);
      
      // Store command message ID for possible deletion in the scene
      const commandMessageId = ctx.message.message_id;
      
      // Enter the scene and pass the command message ID
      return ctx.scene.enter('check-voters', { commandMessageId });
    });
    
    logger.info('Scenes setup completed');
  } catch (error) {
    logger.error('Error setting up scenes:', error);
  }
};

module.exports = { setupScenes };