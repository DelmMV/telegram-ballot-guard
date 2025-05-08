const { Markup, Scenes } = require('telegraf');
const Poll = require('../models/Poll');
const logger = require('../utils/logger');

/**
 * Extract mentions from message entities
 * @param {Array} entities - Message entities from Telegram
 * @param {string} text - Full message text
 * @param {number} fromId - User ID of message sender
 * @returns {Array} Array of user mentions
 */
const extractMentions = (entities, text, fromId) => {
  if (!entities) return [];
  
  const mentions = [];
  entities.forEach(entity => {
    if (entity.type === 'mention') {
      // Extract username from @mention
      const username = text.substring(entity.offset + 1, entity.offset + entity.length);
      // Generate a temporary negative userId for username mentions
      // This avoids MongoDB validation errors but still makes it clear this isn't a real userId
      const tempUserId = -Math.floor(Math.random() * 1000000) - 1;
      mentions.push({
        username,
        userId: tempUserId, // Using temporary negative ID to pass validation
        firstName: null,
        lastName: null,
        voted: false
      });
    } else if (entity.type === 'text_mention' && entity.user) {
      // Text mentions already have user objects
      mentions.push({
        username: entity.user.username || null,
        userId: entity.user.id,
        firstName: entity.user.first_name || null,
        lastName: entity.user.last_name || null,
        voted: entity.user.id === fromId // Creator is automatically marked as voted
      });
    }
  });
  
  return mentions;
};

/**
 * Create a poll creation wizard scene with minimal messages
 * @returns {Scenes.WizardScene} Wizard scene for creating polls
 */
const createPollScene = () => {
  // Step 1: Start poll creation process and collect title
  const startPollCreation = async (ctx) => {
    const { t } = ctx.i18n;
    
    // Check if command is used in group or supergroup
    if (!ctx.isAnyGroup) {
      await ctx.reply(t('poll.groupOnly'));
      return ctx.scene.leave();
    }
    
    // Initialize scene data
    ctx.wizard.state.pollData = {
      chatId: ctx.chat.id,
      creatorId: ctx.from.id,
      options: [],
      state: 'collecting_title' // Track what we're collecting
    };
    
    // Handle imported mentions from checkVoters scene
    let initialPrompt = '';
    
    if (ctx.scene.state?.checkData) {
      if (ctx.scene.state.checkData.importedMentions && ctx.scene.state.checkData.importedMentions.length > 0) {
        // Store the mentions for later use
        ctx.wizard.state.pollData.importedMentions = ctx.scene.state.checkData.importedMentions;
        ctx.wizard.state.pollData.selectedOption = ctx.scene.state.checkData.selectedOption;
        
        // Store original poll title if available
        if (ctx.scene.state.checkData.originalPollTitle) {
          ctx.wizard.state.pollData.originalPollTitle = ctx.scene.state.checkData.originalPollTitle;
        }
        
        // Create a suggested title based on selected option
        const suggestedTitle = t('scenes.voters.followUpTitle', { 
          option: ctx.scene.state.checkData.selectedOption 
        });
        
        // Create mentions string for display
        const mentionsString = ctx.scene.state.checkData.importedMentions.join(' ');
        
        // Add to initial prompt
        initialPrompt = `${t('scenes.poll.usingImportedMentions', { 
          count: ctx.wizard.state.pollData.importedMentions.length,
          option: ctx.wizard.state.pollData.selectedOption 
        })}\n\n${t('scenes.poll.suggestedTitle')}: "${suggestedTitle}"\n\n`;
        
        // Pre-set the title
        ctx.wizard.state.pollData.suggestedTitle = suggestedTitle;
      }
    }
    
    // In compact mode, use a shorter prompt
    const promptText = ctx.wizard.state.pollData.compactMode 
      ? t('scenes.poll.compactPrompt')
      : `${initialPrompt}${t('scenes.poll.combinedPrompt')}`;
      
    await ctx.reply(
      promptText,
      { 
        reply_markup: { 
          force_reply: true, 
          input_field_placeholder: ctx.wizard.state.pollData.suggestedTitle || t('scenes.poll.titlePlaceholder')
        } 
      }
    );
    
    return ctx.wizard.next();
  };
  
  // Step 2: Process user input based on current state
  const processUserInput = async (ctx) => {
    const { t } = ctx.i18n;
    
    // Handle commands
    if (ctx.message && ctx.message.text) {
      if (ctx.message.text.startsWith('/cancel')) {
        await ctx.reply(t('scenes.poll.cancelled'));
        return ctx.scene.leave();
      }
      
      if (ctx.message.text.startsWith('/done')) {
        return await handleDoneCommand(ctx);
      }
    }
    
    // Check if we have a text message
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply(t('scenes.poll.noText'));
      return;
    }
    
    // Process based on current state
      const currentState = ctx.wizard.state.pollData.state;
      const compactMode = ctx.wizard.state.pollData.compactMode === true;
    
      if (currentState === 'collecting_title') {
        // Process title
        await processTitle(ctx);
      
        // Move to collecting options
        ctx.wizard.state.pollData.state = 'collecting_options';
      
        // Ask for first option - use compact prompt in compact mode
        const optionPromptText = compactMode 
          ? t('scenes.poll.compactOptionPrompt', { count: 1 })
          : t('scenes.poll.optionPrompt', { count: 1 });
        
        await ctx.reply(
          optionPromptText,
          { 
            reply_markup: { 
              force_reply: true, 
              input_field_placeholder: t('scenes.poll.optionPlaceholder') 
            } 
          }
        );
    } else if (currentState === 'collecting_options') {
      // Process option
      await processOption(ctx);
      
      // Determine next prompt
      const optionCount = ctx.wizard.state.pollData.options.length;
      
      if (optionCount >= 10) {
        // Automatically finish if we have 10 options (Telegram limit)
        return await showConfirmation(ctx);
      } else if (optionCount >= 2) {
        // Show current options with "done" button when we have enough
        const currentOptions = ctx.wizard.state.pollData.options.map(
          (opt, idx) => `${idx + 1}. ${opt.text}`
        ).join('\n');
        
        // In compact mode, use a shorter message
        const compactMode = ctx.wizard.state.pollData.compactMode === true;
        const messageText = compactMode
          ? `${t('scenes.poll.compactOptionAdded')}\n${currentOptions}\n\n${t('scenes.poll.addMoreOrDone')}`
          : `${t('scenes.poll.optionAdded', { option: ctx.message.text.trim() })}\n\n` +
            `${t('scenes.poll.currentOptions')}:\n${currentOptions}\n\n` +
            `${t('scenes.poll.addMoreOrDone')}`;
        
        await ctx.reply(
          messageText,
          Markup.keyboard([
            [t('scenes.poll.doneButton')]
          ])
          .oneTime()
          .resize()
        );
      } else {
        // Ask for next option
        const compactMode = ctx.wizard.state.pollData.compactMode === true;
        const optionPromptText = compactMode 
          ? t('scenes.poll.compactOptionPrompt', { count: optionCount + 1 })
          : t('scenes.poll.optionPrompt', { count: optionCount + 1 });
          
        await ctx.reply(
          optionPromptText,
          { 
            reply_markup: { 
              force_reply: true, 
              input_field_placeholder: t('scenes.poll.optionPlaceholder') 
            } 
          }
        );
      }
    }
    
    return;
  };
  
  // Process title input
  const processTitle = async (ctx) => {
    const { t } = ctx.i18n;
    
    // Save title
    const title = ctx.message.text.trim();
    ctx.wizard.state.pollData.title = title;
    
    // Extract mentions from the title
    if (ctx.message.entities) {
      ctx.wizard.state.pollData.mentions = extractMentions(
        ctx.message.entities,
        ctx.message.text,
        ctx.from.id
      );
    } else {
      ctx.wizard.state.pollData.mentions = [];
    }
    
    // If we have imported mentions, prepare them for the poll
    if (ctx.wizard.state.pollData.importedMentions && ctx.wizard.state.pollData.importedMentions.length > 0) {
      const mentionsString = ctx.wizard.state.pollData.importedMentions.join(' ');
      ctx.wizard.state.pollData.mentionsString = mentionsString;
    }
  };
  
  // Process option input
  const processOption = async (ctx) => {
    // Add option
    const optionText = ctx.message.text.trim();
    ctx.wizard.state.pollData.options.push({
      text: optionText,
      voterIds: []
    });
  };
  
  // Handle /done command and validation
  const handleDoneCommand = async (ctx) => {
    const { t } = ctx.i18n;
    
    // Check if we're collecting options and if we have enough
    if (ctx.wizard.state.pollData.state === 'collecting_options') {
      if (ctx.wizard.state.pollData.options.length < 2) {
        await ctx.reply(t('poll.minOptions'));
        return;
      }
      
      // Show confirmation
      return await showConfirmation(ctx);
    } else {
      await ctx.reply(t('scenes.poll.cannotFinishYet'));
      return;
    }
  };
  
  // Show poll confirmation
  const showConfirmation = async (ctx) => {
    const { t } = ctx.i18n;
    
    // Prepare poll preview
    const title = ctx.wizard.state.pollData.title;
    const options = ctx.wizard.state.pollData.options.map(
      (opt, idx) => `${idx + 1}. ${opt.text}`
    ).join('\n');
    
    // Update state
    ctx.wizard.state.pollData.state = 'confirming';
    
    // Show confirmation with buttons
    // Show confirmation - compact version if in compact mode
    const compactMode = ctx.wizard.state.pollData.compactMode === true;
    const confirmationText = compactMode
      ? `📊 ${title}\n\n${options}`
      : `${t('scenes.poll.confirmation')}\n\n📊 ${title}\n\n${options}`;
      
    await ctx.reply(
      confirmationText,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(t('scenes.poll.createButton'), 'create_poll'),
          Markup.button.callback(t('scenes.poll.cancelButton'), 'cancel_poll')
        ]
      ])
    );
    
    return ctx.wizard.next();
  };
  
  // Step 3: Handle confirmation
  const handleConfirmation = async (ctx) => {
    const { t } = ctx.i18n;
    
    // Process text input if we're waiting for options
    if (ctx.message && ctx.message.text && ctx.wizard.state.pollData.state === 'collecting_options') {
      return await processUserInput(ctx);
    }
    
    // Only process callback queries for confirmation
    if (!ctx.callbackQuery) {
      return;
    }
    
    const action = ctx.callbackQuery.data;
    
    if (action === 'cancel_poll') {
      await ctx.answerCbQuery(t('scenes.poll.cancelled'));
      await ctx.reply(t('scenes.poll.cancelledMessage'));
      return ctx.scene.leave();
    }
    
    if (action === 'create_poll') {
      await ctx.answerCbQuery(t('scenes.poll.creating'));
      
      try {
        // Get poll data
        const { title, mentionsString, options, mentions, importedMentions } = ctx.wizard.state.pollData;
        
        // Create and send the poll
        const pollMessage = await ctx.replyWithPoll(
          title,
          options.map(o => o.text),
          {
            is_anonymous: false,
            allows_multiple_answers: false,
          }
        );
        
        logger.info(`Poll created with message ID: ${pollMessage.message_id}`);
        
        // Send a separate message with mentions to ensure they trigger notifications
        if (mentionsString) {
          // Use different message template based on whether this poll is from imported mentions
          const messageKey = ctx.wizard.state.pollData.importedMentions && ctx.wizard.state.pollData.importedMentions.length > 0
            ? 'scenes.poll.mentionsForCheckVoters'
            : 'scenes.poll.mentionsForPoll';
            
          await ctx.reply(
            t(messageKey, {
              messageId: pollMessage.message_id,
              mentions: mentionsString,
              option: ctx.wizard.state.pollData.selectedOption || '',
              title: title,
              originalPollTitle: ctx.wizard.state.pollData.originalPollTitle || 'Untitled Poll'
            })
          );
          logger.info(`Sent separate message with mentions: "${mentionsString}"`);
        }
        
        // Save poll to database
        const poll = new Poll({
          chatId: ctx.chat.id,
          messageId: pollMessage.message_id,
          pollId: pollMessage.poll.id,
          creatorId: ctx.from.id,
          title: title,
          options: options,
          mentions: mentions || [],
          isAnonymous: false,
          isMultipleChoice: false
        });
        
        try {
          await poll.save();
        } catch (saveError) {
          logger.error('Error saving poll to database:', saveError);
          // Try to save without mentions if that's causing the problem
          if (saveError.name === 'ValidationError' && saveError.message.includes('mentions')) {
            poll.mentions = [];
            await poll.save();
            logger.info('Saved poll without mentions due to validation error');
          } else {
            throw saveError; // Re-throw if it's not a mentions validation error
          }
        }
        
        logger.info(`New poll created in chat ${ctx.chat.id} by user ${ctx.from.id}`, {
          pollId: poll._id,
          title
        });
        
        // Send the success message - with or without mentions info depending on compact mode
        const compactMode = ctx.wizard.state.pollData.compactMode === true;
        
        if (compactMode) {
          // In compact mode, just send a minimal success message
          await ctx.reply(t('scenes.poll.compactSuccess', { messageId: pollMessage.message_id }));
        } else {
          // In normal mode, show mentions and success message
          await sendMentionsInfo(ctx, pollMessage.message_id, mentions, importedMentions);
          await ctx.reply(t('scenes.poll.success'));
        }
      } catch (error) {
        logger.error('Error creating poll:', error);
        
        // Give user more specific error message when possible
        if (error.name === 'ValidationError') {
          await ctx.reply(`${t('poll.createError')} (Validation error: ${error.message})`);
        } else {
          await ctx.reply(t('poll.createError'));
        }
      }
      
      return ctx.scene.leave();
    }
  };
  
  // Helper to send mentions info after poll creation
  const sendMentionsInfo = async (ctx, messageId, mentions, importedMentions) => {
    const { t } = ctx.i18n;
    
    // If we have imported mentions, show confirmation
    if (importedMentions && importedMentions.length > 0) {
      await ctx.reply(
        t('scenes.poll.includedImportedMentions', { 
          count: importedMentions.length, 
          option: ctx.wizard.state.pollData.selectedOption || '' 
        })
      );
    }
    
    // If there are extracted mentions, send info about them
    if (mentions && mentions.length > 0) {
      const mentionList = mentions.map(m => 
        m.username ? `@${m.username}` : `[User](tg://user?id=${m.userId})`
      ).join(', ');
      
      const userWord = mentions.length === 1 ? t('poll.user') : t('poll.users');
      
      await ctx.reply(
        `${t('poll.createdWith', { count: mentions.length, users: userWord })}: ${mentionList}\n` +
        `${t('poll.checkVoters', { messageId })}\n` +
        `${t('poll.checkVotersExample', { messageId })}`
      );
    }
  };
  
  // Create scene with steps
  return new Scenes.WizardScene(
    'create-poll',
    startPollCreation,
    processUserInput,
    handleConfirmation
  );
};

module.exports = createPollScene;