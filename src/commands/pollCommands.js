const { Markup } = require('telegraf');
const Poll = require('../models/Poll');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

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
      mentions.push({
        username,
        userId: null, // Will be resolved later if possible
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
 * Register poll-related commands
 * @param {import('telegraf').Telegraf} bot - Telegraf bot instance
 */
const registerPollCommands = (bot) => {
  // Create a new poll
  bot.command('newpoll', async (ctx) => {
    const { t } = ctx.i18n;
    
    // Check if command is used in group or supergroup
    if (!ctx.isAnyGroup) {
      return ctx.reply(t('poll.groupOnly'));
    }
    
    const commandArgs = ctx.message.text.split(/\s+/).slice(1).join(' ');
    
    if (!commandArgs) {
      return ctx.reply(
        `${t('poll.provide')}\n` +
        `${t('poll.syntax')}\n\n` +
        `${t('poll.mentionExample')}\n` +
        `${t('poll.mentionSample')}`
      );
    }
    
    const parts = commandArgs.split('|').map(part => part.trim());
    const title = parts[0];
    const options = parts.slice(1);
    
    if (options.length < 2) {
      return ctx.reply(t('poll.minOptions'));
    }
    
    try {
      // Extract mentions from poll title
      const mentions = extractMentions(
        ctx.message.entities, 
        ctx.message.text, 
        ctx.from.id
      );
      
      // Send poll to chat
      const pollMessage = await ctx.replyWithPoll(
        title,
        options,
        {
          is_anonymous: false,
          allows_multiple_answers: false,
        }
      );
      
      // Save poll to database
      const poll = new Poll({
        chatId: ctx.chat.id,
        messageId: pollMessage.message_id,
        pollId: pollMessage.poll.id, // Store the poll_id from Telegram
        creatorId: ctx.from.id,
        title: title,
        options: options.map(text => ({ text, voterIds: [] })),
        mentions: mentions,
        isAnonymous: false,
        isMultipleChoice: false
      });
      
      await poll.save();
      
      logger.info(`New poll created in chat ${ctx.chat.id} by user ${ctx.from.id}`, {
        pollId: poll._id,
        title,
        options
      });
      
      // If there are mentions, send follow-up message
      if (mentions.length > 0) {
        const mentionList = mentions.map(m => 
          m.username ? `@${m.username}` : `[User](tg://user?id=${m.userId})`
        ).join(', ');
          
        const userWord = mentions.length === 1 ? t('poll.user') : t('poll.users');
          
        await ctx.reply(
          `${t('poll.createdWith', { count: mentions.length, users: userWord })}: ${mentionList}\n` +
          `${t('poll.checkVoters', { messageId: pollMessage.message_id })}\n` +
          `${t('poll.checkVotersExample', { messageId: pollMessage.message_id })}`,
          { parse_mode: 'Markdown' }
        );
      } else {
        // Even if there are no mentions, add a note about checking voters
        await ctx.reply(
          `${t('poll.pollCreated')}\n` +
          `${t('poll.checkVoters', { messageId: pollMessage.message_id })}\n` +
          `${t('poll.checkVotersExample', { messageId: pollMessage.message_id })}`,
          { parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      logger.error('Error creating poll:', error);
      await ctx.reply(t('poll.createError'));
    }
  });
  
  // Handle poll updates (when poll state changes)
  bot.on('poll', async (ctx) => {
    try {
      // Telegram sends poll updates in two formats:
      // 1. ctx.update.poll (when polling an existing poll)
      // 2. ctx.poll (in some Telegram versions/contexts)
      const pollData = ctx.update?.poll || ctx.poll;
      
      if (!pollData) {
        logger.error('poll event missing poll data', {
          hasUpdate: !!ctx.update,
          hasPoll: !!ctx.poll,
          hasUpdatePoll: !!ctx.update?.poll
        });
        return;
      }
      
      const poll = pollData;
      
      logger.debug(`Received poll update event for poll_id: ${poll.id || 'unknown'}`, {
        question: poll.question || 'no question',
        total_voter_count: poll.total_voter_count || 0,
        options: poll.options ? poll.options.length : 0
      });
      
      // Validate poll data
      if (!poll.id) {
        logger.warn('Invalid poll data in update event');
        return;
      }
    
      // Find poll in database by poll_id
      let dbPoll = await Poll.findOne({ 
        pollId: poll.id
      });
      
      // If not found by pollId, try to find by originalPollId
      if (!dbPoll) {
        dbPoll = await Poll.findOne({
          originalPollId: poll.id
        });
      }
      
      if (!dbPoll) {
        logger.debug(`Poll not found for poll update event, poll_id: ${poll.id}`);
        return;
      }
      
      if (dbPoll.isClosed) {
        logger.debug(`Ignoring update for closed poll: ${dbPoll._id}`);
        return;
      }
      
      logger.debug(`Processing poll update for poll: ${dbPoll._id}`, {
        isTracked: dbPoll.isTracked,
        options: dbPoll.options.length,
        title: dbPoll.title,
        total_voter_count: poll.total_voter_count,
        dbPoll_voter_count: dbPoll.total_voter_count
      });
      
      // Update total voter count
      const oldVoterCount = dbPoll.total_voter_count || 0;
      dbPoll.total_voter_count = poll.total_voter_count;
      
      // If this is a tracked poll, try to update the vote counts for each option
      if (dbPoll.isTracked && poll.options && Array.isArray(poll.options)) {
        // Go through each option and update vote counts
        for (let i = 0; i < poll.options.length && i < dbPoll.options.length; i++) {
          const pollOption = poll.options[i];
          const dbOption = dbPoll.options[i];
          
          if (pollOption && typeof pollOption.voter_count === 'number') {
            const newVoterCount = pollOption.voter_count;
            const oldVoterCount = dbOption.existingVotes || 0;
            
            // Only update if we have more votes than before
            if (newVoterCount > oldVoterCount) {
              // Calculate how many new votes we have
              const newVotes = newVoterCount - oldVoterCount;
              
              logger.debug(`Option "${dbOption.text}" has ${newVotes} new votes`, {
                optionIndex: i,
                oldCount: oldVoterCount,
                newCount: newVoterCount,
                pollId: poll.id
              });
              
              // Create placeholder IDs for the new votes
              if (newVotes > 0) {
                // Safely find the lowest existing placeholder ID or use a default
                const negativeIds = dbOption.voterIds.filter(id => id < 0);
                const baseId = -1000000 * (i + 1);
                const lastPlaceholderId = negativeIds.length > 0 
                  ? Math.min(...negativeIds) - 1 
                  : baseId - 1;
                const newVoterIds = Array.from(
                  { length: newVotes }, 
                  (_, idx) => lastPlaceholderId - idx
                );
                
                // Add new placeholder IDs
                dbOption.voterIds = [...dbOption.voterIds, ...newVoterIds];
                dbOption.existingVotes = newVoterCount;
                
                logger.debug(`Added ${newVotes} placeholder IDs for new votes`, {
                  optionIndex: i,
                  text: dbOption.text,
                  placeholderIdsStart: lastPlaceholderId
                });
              }
            }
          }
        }
      }
      
      // Save the updated poll
      await dbPoll.save();
      
      logger.debug(`Updated poll ${dbPoll._id} with new vote counts`, {
        oldTotalVoterCount: oldVoterCount,
        newTotalVoterCount: dbPoll.total_voter_count
      });
    } catch (error) {
      logger.error(`Error handling poll update for poll_id ${poll?.id || 'unknown'}:`, error);
    }
  });

  // Handle poll votes
  bot.on('poll_answer', async (ctx) => {
    try {
      // Telegram may send poll_answer in different formats
      const pollAnswerData = ctx.pollAnswer || ctx.update?.poll_answer;
      
      if (!pollAnswerData) {
        logger.error('poll_answer event missing data', {
          hasPollAnswer: !!ctx.pollAnswer,
          hasUpdatePollAnswer: !!ctx.update?.poll_answer,
          eventType: ctx.updateType || 'unknown'
        });
        return;
      }
      
      const { poll_id, user, option_ids } = pollAnswerData;
      
      if (!poll_id || !user) {
        logger.error('poll_answer event missing required data', {
          has_poll_id: !!poll_id,
          has_user: !!user
        });
        return;
      }
    
      logger.debug(`Processing poll_answer for poll_id: ${poll_id}`, {
        userId: user?.id,
        user_first_name: user?.first_name,
        user_last_name: user?.last_name,
        options: option_ids,
        updateType: ctx.updateType || 'unknown'
      });
    
      // Find poll in database by poll_id (note: in poll_answer updates, ctx.chat is undefined)
      let poll = await Poll.findOne({ 
        pollId: poll_id
      });
      
      // If not found by pollId, try to find by originalPollId
      if (!poll) {
        poll = await Poll.findOne({
          originalPollId: poll_id
        });
      }
      
      // If still not found, try to search by including a partial match on poll_id
      if (!poll) {
        // This is necessary because sometimes Telegram sends shortened or modified poll_id values
        let allActivePolls = [];
        try {
          // Try finding by prefix first - MongoDB might not support regex in some versions
          const pollIdPrefix = poll_id.substring(0, 10);
          try {
            allActivePolls = await Poll.find({ 
              isClosed: false,
              $or: [
                { pollId: { $regex: pollIdPrefix, $options: 'i' } },
                { originalPollId: { $regex: pollIdPrefix, $options: 'i' } }
              ]
            });
          } catch (regexError) {
            // Try string starts with approach instead of regex
            logger.warn(`Regex search failed: ${regexError.message}. Trying string-based search.`);
            allActivePolls = await Poll.find({
              isClosed: false,
              $or: [
                { pollId: new RegExp('^' + pollIdPrefix) },
                { originalPollId: new RegExp('^' + pollIdPrefix) }
              ]
            });
          }
          
          // If that fails, get all active polls
          if (allActivePolls.length === 0) {
            allActivePolls = await Poll.find({ isClosed: false });
          }
        } catch (err) {
          // Fallback if all searches fail
          logger.warn(`All advanced searches failed: ${err.message}. Using basic search`);
          allActivePolls = await Poll.find({ isClosed: false });
        }
        
        logger.debug(`Scanning ${allActivePolls?.length || 0} active polls for incoming vote`);
        
        if (allActivePolls.length === 1) {
          // If we found exactly one match, use it
          poll = allActivePolls[0];
          logger.debug(`Found poll by partial match: ${poll._id}`);
        } else if (allActivePolls.length > 1) {
          // If we found multiple matches, use the most recently updated one
          poll = allActivePolls.sort((a, b) => b.updatedAt - a.updatedAt)[0];
          logger.debug(`Found multiple matching polls, using most recent: ${poll._id}`);
        } else {
          logger.debug(`No polls found for poll_id: ${poll_id} (including partial matches)`);
          return;
        }
      }
      
      if (poll.isClosed) {
        logger.debug(`Attempted vote on closed poll: ${poll._id}`);
        return;
      }
      
      logger.debug(`Processing vote for poll: ${poll._id}`, {
        isTracked: poll.isTracked,
        options: poll.options.length,
        title: poll.title,
        userId: user?.id,
        chatId: poll.chatId
      });
      
      // Record vote
      if (option_ids && option_ids.length > 0) {
        for (const optionIndex of option_ids) {
          if (optionIndex >= 0 && optionIndex < poll.options.length) {
            // If not multiple choice, remove previous votes
            if (!poll.isMultipleChoice) {
              poll.options.forEach(option => {
                // Ensure voterIds exists
                if (!option.voterIds) {
                  option.voterIds = [];
                }
                // Only remove this user's votes (positive IDs), keep placeholders for existing votes (negative IDs)
                option.voterIds = option.voterIds.filter(id => {
                  // Remove the user's ID
                  if (id === user.id) return false;
                  // Keep all negative IDs (placeholders)
                  if (id < 0) return true;
                  // Keep all other IDs
                  return true;
                });
              });
            }
            
            // Ensure option has voterIds array
            if (!poll.options[optionIndex].voterIds) {
              poll.options[optionIndex].voterIds = [];
            }
            
            // Add vote if not already voted for this option
            if (!poll.options[optionIndex].voterIds.includes(user.id)) {
              poll.options[optionIndex].voterIds.push(user.id);
              
              // Update total vote count for the option if necessary
              const realVoterCount = poll.options[optionIndex].voterIds.filter(id => id > 0).length;
              if (poll.options[optionIndex].existingVotes < realVoterCount) {
                poll.options[optionIndex].existingVotes = realVoterCount;
              }
              
              logger.debug(`Added vote from user ${user.id} for option ${optionIndex}`, {
                pollId: poll._id.toString(),
                optionText: poll.options[optionIndex].text,
                totalVoters: poll.options[optionIndex].voterIds.length,
                realVoters: realVoterCount
              });
            }
          }
        }
      } else {
        // User retracted their vote, remove from all options
        let voteRemoved = false;
        
        poll.options.forEach(option => {
          // Ensure voterIds exists
          if (!option.voterIds) {
            option.voterIds = [];
          } else {
            // Check if the user had voted for this option
            const hadVote = option.voterIds.includes(user.id);
            
            // Only remove this user's vote (positive IDs), keep placeholders for existing votes (negative IDs)
            option.voterIds = option.voterIds.filter(id => {
              // Remove the user's ID
              if (id === user.id) return false;
              // Keep all negative IDs (placeholders)
              if (id < 0) return true;
              // Keep all other IDs
              return true;
            });
            
            if (hadVote) {
              voteRemoved = true;
              
              // Adjust the existingVotes count if necessary
              const realVoterCount = option.voterIds.filter(id => id > 0).length;
              if (option.existingVotes > realVoterCount) {
                option.existingVotes = realVoterCount;
              }
            }
          }
        });
        
        logger.debug(`User ${user.id} retracted vote from poll ${poll._id}`, {
          voteRemoved: voteRemoved,
          userId: user.id
        });
      }
      
      // Update mention status if user is mentioned and mentions array exists
      if (poll.mentions && Array.isArray(poll.mentions)) {
        const mentionIndex = poll.mentions.findIndex(mention => 
          mention.userId === user.id || 
          (mention.username && mention.username === user.username)
        );
        
        if (mentionIndex !== -1) {
          // Update user info if we only had username before
          if (!poll.mentions[mentionIndex].userId) {
            poll.mentions[mentionIndex].userId = user.id;
            poll.mentions[mentionIndex].firstName = user.first_name;
            poll.mentions[mentionIndex].lastName = user.last_name;
          }
          
          poll.mentions[mentionIndex].voted = option_ids.length > 0;
        }
      }
      
      // Update the poll's updatedAt timestamp
      poll.updatedAt = new Date();
      
      // Recalculate total_voter_count based on unique voters
      const uniqueVoters = new Set();
      
      // Count real voters (positive IDs)
      poll.options.forEach(option => {
        option.voterIds.forEach(id => {
          if (id > 0) {
            uniqueVoters.add(id);
          }
        });
      });
      
      // Count placeholder votes (negative IDs) - each represents one vote
      const placeholderVotes = poll.options.reduce(
        (sum, option) => sum + option.voterIds.filter(id => id < 0).length, 
        0
      );
      
      // Update total_voter_count
      const newTotalVoterCount = uniqueVoters.size + placeholderVotes;
      
      if (poll.total_voter_count !== newTotalVoterCount) {
        logger.debug(`Updating total_voter_count from ${poll.total_voter_count} to ${newTotalVoterCount}`, {
          pollId: poll._id.toString(),
          uniqueRealVoters: uniqueVoters.size,
          placeholderVotes: placeholderVotes
        });
        poll.total_voter_count = newTotalVoterCount;
      }
      
      // Save the poll
      await poll.save();
      
      logger.debug(`Vote recorded for user ${user.id} on poll ${poll._id}`, {
        votedOptions: option_ids,
        pollTitle: poll.title,
        isTracked: poll.isTracked,
        totalVoterCount: poll.total_voter_count
      });
    } catch (error) {
      logger.error(`Error handling poll answer for poll_id ${poll_id || 'unknown'}:`, error);
    }
  });
  
  // Legacy version of checkvoters command (will be redirected to scene)
  bot.command('checkvoters', async (ctx) => {
    // This will be handled by the scenes middleware in src/scenes/index.js
    // Legacy format of the command is now supported as a fallback in the scene
  });
  
  // Force refresh data for a tracked poll
  bot.command('refreshpoll', async (ctx) => {
    const { t } = ctx.i18n;
    
    // Only allowed in groups
    if (!ctx.isAnyGroup) {
      return ctx.reply(t('poll.groupOnly'));
    }
    
    // Check if there's a replied-to message
    if (!ctx.message.reply_to_message) {
      return ctx.reply(t('refresh.replyRequired') || 'Please reply to a poll message to refresh its data.');
    }
    
    const repliedMessage = ctx.message.reply_to_message;
    
    // Check if the replied message is a poll
    if (!repliedMessage.poll) {
      return ctx.reply(t('refresh.notAPoll') || 'The message you replied to is not a poll.');
    }
    
    try {
      // Validate input
      if (!ctx.chat || !repliedMessage) {
        return ctx.reply(t('refresh.error') || 'Error: Invalid input.');
      }
      
      // Check if this poll is being tracked
      const poll = await Poll.findOne({
        chatId: ctx.chat.id,
        messageId: repliedMessage.message_id
      });
      
      if (!poll) {
        return ctx.reply(t('refresh.notTracked', { messageId: repliedMessage.message_id }) || 
          `This poll is not being tracked.`);
      }
      
      if (!poll.isTracked) {
        return ctx.reply(t('refresh.notTracked', { messageId: repliedMessage.message_id }) || 
          `This poll is not being tracked.`);
      }
      
      // Extract poll data from the message
      const { poll: telegramPoll } = repliedMessage;
      
      // Update total voter count
      const oldVoterCount = poll.total_voter_count || 0;
      poll.total_voter_count = telegramPoll.total_voter_count || 0;
      
      // Track changes to vote counts
      let optionsUpdated = 0;
      
      // Update vote counts for each option
      if (telegramPoll.options && Array.isArray(telegramPoll.options)) {
        for (let i = 0; i < telegramPoll.options.length && i < poll.options.length; i++) {
          const telegramOption = telegramPoll.options[i];
          const pollOption = poll.options[i];
          
          if (telegramOption && typeof telegramOption.voter_count === 'number') {
            const newVoterCount = telegramOption.voter_count;
            const oldVoterCount = pollOption.existingVotes || 0;
            
            // Update the vote count if it changed
            if (newVoterCount !== oldVoterCount) {
              // Calculate how many new votes we have
              const voteDiff = newVoterCount - oldVoterCount;
              
              if (voteDiff > 0) {
                // Create placeholder IDs for the new votes
                // Safely find the lowest existing placeholder ID or use a default
                const negativeIds = pollOption.voterIds.filter(id => id < 0);
                const baseId = -1000000 * (i + 1);
                const lastPlaceholderId = negativeIds.length > 0 
                  ? Math.min(...negativeIds) - 1 
                  : baseId - 1;
                const newVoterIds = Array.from(
                  { length: voteDiff }, 
                  (_, idx) => lastPlaceholderId - idx
                );
                
                // Add new placeholder IDs
                pollOption.voterIds = [...pollOption.voterIds, ...newVoterIds];
                
                logger.debug(`Added ${voteDiff} placeholder votes to option "${pollOption.text}"`, {
                  pollId: poll._id,
                  optionIndex: i,
                  newTotal: newVoterCount
                });
              } else if (voteDiff < 0) {
                // Remove placeholder IDs (negative IDs only)
                // Sort by ascending to remove the newest placeholders first (highest negative numbers)
                const placeholderIds = pollOption.voterIds
                  .filter(id => id < 0)
                  .sort((a, b) => a - b);
                
                // Remove |voteDiff| placeholder IDs
                const idsToRemove = placeholderIds.slice(0, Math.abs(voteDiff));
                
                // Keep only IDs not in the idsToRemove list
                pollOption.voterIds = pollOption.voterIds.filter(id => !idsToRemove.includes(id));
                
                logger.debug(`Removed ${Math.abs(voteDiff)} placeholder votes from option "${pollOption.text}"`, {
                  pollId: poll._id,
                  optionIndex: i,
                  newTotal: newVoterCount
                });
              }
              
              // Update the stored vote count
              pollOption.existingVotes = newVoterCount;
              optionsUpdated++;
            }
          }
        }
      }
      
      // Save the updated poll
      poll.updatedAt = new Date();
      await poll.save();
      
      // Send confirmation
      const message = optionsUpdated > 0 || oldVoterCount !== poll.total_voter_count
        ? t('refresh.updated', { 
            optionsCount: optionsUpdated, 
            oldCount: oldVoterCount, 
            newCount: poll.total_voter_count 
          }) || `Poll refreshed: Updated ${optionsUpdated} options. Total votes: ${oldVoterCount} → ${poll.total_voter_count}`
        : t('refresh.noChanges') || 'Poll refreshed: No changes detected.';
      
      await ctx.reply(message);
      
      // Try to delete command message
      try {
        await ctx.deleteMessage(ctx.message.message_id);
      } catch (error) {
        logger.warn('Could not delete refreshpoll command message:', error);
      }
      
      logger.info(`Poll ${poll._id} refreshed by user ${ctx.from.id} in chat ${ctx.chat.id}`, {
        optionsUpdated: optionsUpdated,
        oldVoterCount: oldVoterCount,
        newVoterCount: poll.total_voter_count
      });
    } catch (error) {
      logger.error('Error refreshing poll:', error);
      await ctx.reply(t('refresh.error') || 'An error occurred while refreshing the poll.');
    }
  });
  
  // Track poll command removed - functionality was not working correctly
  // Команда closepoll удалена
};

module.exports = {
  registerPollCommands
};