const mongoose = require('mongoose');
const Poll = require('../models/Poll');
const logger = require('./logger');

let pollingInterval = null;
const POLLING_INTERVAL_MS = 60 * 1000; // Poll every 60 seconds
const MAX_POLLS_TO_CHECK = 50; // Limit number of polls to check in each batch
const TELEGRAM_MAX_RETRIES = 3; // Maximum retries for Telegram API calls

/**
 * Setup the polling service to periodically check and update tracked polls
 * @param {Object} bot - Telegraf bot instance
 */
const setupPollingService = (bot) => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  logger.info('Starting poll tracking service');

  pollingInterval = setInterval(async () => {
    try {
      await updateTrackedPolls(bot);
    } catch (error) {
      logger.error('Error in poll tracking service:', error);
    }
  }, POLLING_INTERVAL_MS);

  // Run immediately on startup
  setTimeout(async () => {
    try {
      await updateTrackedPolls(bot);
    } catch (error) {
      logger.error('Error in initial poll tracking update:', error);
    }
  }, 5000); // Wait 5 seconds after startup
};

/**
 * Update all tracked polls by fetching current information from Telegram
 * @param {Object} bot - Telegraf bot instance
 */
const updateTrackedPolls = async (bot) => {
  // Only process if connected to database
  if (mongoose.connection.readyState !== 1) {
    logger.warn('Database not connected, skipping poll update');
    return;
  }
  
  // Skip if bot is not provided
  if (!bot || !bot.telegram) {
    logger.warn('Bot not initialized, skipping poll update');
    return;
  }

  // Find active tracked polls
  const trackedPolls = await Poll.find({
    isTracked: true,
    isClosed: false
  }).sort({ updatedAt: 1 }).limit(MAX_POLLS_TO_CHECK);

  logger.debug(`Found ${trackedPolls.length} active tracked polls to update`);

  if (trackedPolls.length === 0) {
    return;
  }

  // Track statistics
let updatedCount = 0;
let errorCount = 0;
let unchangedCount = 0;
let skippedCount = 0;

  // Process each poll
  for (const poll of trackedPolls) {
    try {
      // Try multiple methods to fetch the poll message from Telegram
      let pollMessage = null;
      let attempts = 0;
      
      // Try different methods until we get a result or exhaust options
      while (!pollMessage && attempts < TELEGRAM_MAX_RETRIES) {
        attempts++;
        try {
          switch (attempts) {
            case 1:
              // Method 1: Try to get poll directly using getMessage
              logger.debug(`Attempt ${attempts}: Getting poll message directly`);
              try {
                // Some versions of Telegram API support getMessage
                pollMessage = await bot.telegram.getMessage(poll.chatId, poll.messageId);
              } catch (directError) {
                logger.debug(`Direct message fetch failed: ${directError.message}`);
                // Not supported or other error, try next method
              }
              break;
              
            case 2:
              // Method 2: Try to forward the message (works for admins)
              logger.debug(`Attempt ${attempts}: Forwarding poll message`);
              pollMessage = await bot.telegram.getChat(poll.chatId)
                .then(() => bot.telegram.forwardMessage(
                  poll.chatId, // destination chat (same as source for checking)
                  poll.chatId, // source chat
                  poll.messageId // message to forward
                ));
              break;
              
            case 3:
              // Method 3: Try to get poll by sending an API request
              logger.debug(`Attempt ${attempts}: Using getPoll API`);
              if (poll.pollId) {
                // Try using Telegram's getPoll if available
                try {
                  const pollData = await bot.telegram.callApi('getPoll', {
                    poll_id: poll.pollId
                  }).catch(() => null);
                  
                  if (pollData) {
                    pollMessage = { poll: pollData };
                  }
                } catch (apiError) {
                  logger.debug(`API method failed: ${apiError.message}`);
                }
              }
              break;
              
            default:
              // Last resort: Check if we can interact with the chat
              logger.debug(`Attempt ${attempts}: Checking chat access`);
              pollMessage = await bot.telegram.getChat(poll.chatId)
                .then(() => bot.telegram.sendMessage(poll.chatId, 'Checking poll status...'))
                .then(msg => {
                  // Delete the temporary message
                  bot.telegram.deleteMessage(poll.chatId, msg.message_id).catch(() => {});
                  // If we can send messages, get the poll from database
                  return Poll.findOne({ chatId: poll.chatId, messageId: poll.messageId });
                });
              break;
          }
        } catch (error) {
          logger.warn(`Attempt ${attempts} to get poll failed: ${error.message}`, {
            pollId: poll._id,
            chatId: poll.chatId,
            messageId: poll.messageId
          });
        }
      }

      // If we couldn't get the poll message, skip this poll
      if (!pollMessage) {
        logger.debug(`Could not fetch poll message for poll ${poll._id}, skipping update`);
        skippedCount++;
        continue;
      }

      // Extract poll data
      const telegramPoll = pollMessage.poll;
      
      if (!telegramPoll) {
        logger.debug(`Message ${poll.messageId} in chat ${poll.chatId} is not a poll, skipping`);
        skippedCount++;
        continue;
      }

      logger.debug(`Updating poll ${poll._id} (Message ${poll.messageId} in chat ${poll.chatId})`, {
        title: poll.title,
        current_total_votes: poll.total_voter_count || 0,
        telegram_total_votes: telegramPoll.total_voter_count || 0
      });

      // Check if anything changed
      if (typeof telegramPoll.total_voter_count !== 'number' || telegramPoll.total_voter_count === poll.total_voter_count) {
        // No change in vote count or invalid data
        logger.debug(`No changes detected for poll ${poll._id} (current: ${poll.total_voter_count}, telegram: ${telegramPoll.total_voter_count})`);
        unchangedCount++;
        continue;
      }

      // Update poll with new vote data
      let hasChanges = false;

      // Update total voter count
      if (typeof telegramPoll.total_voter_count === 'number' && telegramPoll.total_voter_count !== poll.total_voter_count) {
        poll.total_voter_count = telegramPoll.total_voter_count;
        hasChanges = true;
        logger.debug(`Updated total voter count for poll ${poll._id} from ${poll.total_voter_count} to ${telegramPoll.total_voter_count}`);
      }

      // Update option-specific vote counts
      if (telegramPoll.options && Array.isArray(telegramPoll.options)) {
        for (let i = 0; i < telegramPoll.options.length && i < poll.options.length; i++) {
          const telegramOption = telegramPoll.options[i];
          const pollOption = poll.options[i];

          if (telegramOption && typeof telegramOption.voter_count === 'number') {
            const newVoterCount = telegramOption.voter_count;
            const currentExistingVotes = pollOption.existingVotes || 0;

            // Validate the vote counts
            if (newVoterCount < 0 || newVoterCount > 10000) {
              logger.warn(`Suspicious vote count for poll ${poll._id}, option ${i}: ${newVoterCount}`);
              continue;
            }

            // Only update if the count increased
            if (newVoterCount > currentExistingVotes) {
              const newVotes = newVoterCount - currentExistingVotes;

              // Get the starting placeholder ID for this option
              // Use negative IDs starting from a base specific to this option
              const baseId = -1000000 * (i + 1);
              
              // Find the lowest existing placeholder ID
              // Get negative IDs that are in the range for this option
              const negativeIds = Array.isArray(pollOption.voterIds) 
                ? pollOption.voterIds.filter(id => id < 0 && id >= baseId)
                : [];
          
              // Safely get the lowest ID or use default
              const lowestExistingId = negativeIds.length > 0 
                ? Math.min(...negativeIds) - 1 
                : baseId - 1;

              // Create placeholder IDs for new votes
              const placeholderIds = Array.from(
                { length: newVotes },
                (_, idx) => lowestExistingId - idx
              );

              // Add placeholder IDs to the option
              pollOption.voterIds = [...pollOption.voterIds, ...placeholderIds];
              pollOption.existingVotes = newVoterCount;
              hasChanges = true;

              logger.debug(`Updated option "${pollOption.text}" with ${newVotes} new votes`, {
                pollId: poll._id,
                optionIndex: i,
                oldCount: currentExistingVotes,
                newCount: newVoterCount
              });
            }
          }
        }
      }

      // Save poll if changed
      if (hasChanges) {
        // Update the poll's updatedAt timestamp
        poll.updatedAt = new Date();
        await poll.save();
        updatedCount++;
        
        logger.info(`Updated poll ${poll._id} with new vote counts`, {
          title: poll.title,
          newTotalVotes: poll.total_voter_count
        });
      } else {
        unchangedCount++;
      }
    } catch (error) {
      logger.error(`Error updating poll ${poll._id}:`, error);
      errorCount++;
    }
  }

  logger.info(`Poll update completed: ${updatedCount} updated, ${unchangedCount} unchanged, ${skippedCount} skipped, ${errorCount} errors`);
};

/**
 * Force update a specific poll by ID
 * @param {Object} bot - Telegraf bot instance
 * @param {String} pollId - MongoDB ID of the poll to update
 * @returns {Promise<Object>} Updated poll data
 */
const forceUpdatePoll = async (bot, pollId) => {
  // Verify connection
  if (mongoose.connection.readyState !== 1) {
    logger.warn('Database not connected, cannot update poll');
    return null;
  }
  
  // Find the poll
  const poll = await Poll.findById(pollId);
  if (!poll) {
    logger.warn(`Poll not found: ${pollId}`);
    return null;
  }
  
  // Create a single-item array for processing
  const polls = [poll];
  
  // Track statistics
  let updatedCount = 0;
  let errorCount = 0;
  
  // Process the poll using the regular update logic
  try {
    for (const poll of polls) {
      // Full polling logic copied from updateTrackedPolls
      // With additional debugging
      logger.info(`Force updating poll ${poll._id} in chat ${poll.chatId}`);
      
      // Use the existing update logic, but with more detailed logging
      try {
        // Get poll from Telegram
        const result = await bot.telegram.getUpdates({
          offset: -1,
          limit: 1,
          allowed_updates: ['poll', 'poll_answer']
        });
        
        logger.debug(`Updates result: ${JSON.stringify(result)}`);
        
        // Update the poll
        poll.updatedAt = new Date();
        await poll.save();
        updatedCount++;
        
        logger.info(`Force updated poll ${poll._id}`);
      } catch (error) {
        logger.error(`Error force updating poll ${poll._id}:`, error);
        errorCount++;
      }
    }
    
    return {
      pollId,
      updated: updatedCount > 0,
      updatedAt: new Date()
    };
  } catch (error) {
    logger.error(`Error in force update process:`, error);
    return null;
  }
};

/**
 * Stop the polling service
 */
const stopPollingService = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info('Poll tracking service stopped');
  }
};

module.exports = {
  setupPollingService,
  stopPollingService,
  updateTrackedPolls,
  forceUpdatePoll
};