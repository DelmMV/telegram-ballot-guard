const mongoose = require('mongoose');

/**
 * Schema for poll options
 */
const PollOptionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true
  },
  voterIds: {
    type: [Number], // Telegram user IDs of voters
    default: []
  },
  existingVotes: {
    type: Number, // Count of votes that existed before tracking
    default: 0
  }
});

/**
 * Schema for poll mentions
 */
const MentionSchema = new mongoose.Schema({
  userId: {
    type: Number, // Telegram user ID
    required: false
  },
  username: {
    type: String,
    trim: true
  },
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  voted: {
    type: Boolean,
    default: false
  }
});

/**
 * Poll schema for mongoose
 */
const PollSchema = new mongoose.Schema({
  pollId: {
    type: String, // Telegram poll_id
    index: true
  },
  chatId: {
    type: Number, // Telegram chat ID
    required: true,
    index: true
  },
  messageId: {
    type: Number, // Telegram message ID of the poll
    required: true
  },
  creatorId: {
    type: Number, // Telegram user ID of poll creator
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  },
  options: {
    type: [PollOptionSchema],
    required: true,
    validate: [
      {
        validator: function(options) {
          return options.length >= 2; // Poll must have at least 2 options
        },
        message: 'Poll must have at least 2 options'
      }
    ]
  },
  mentions: {
    type: [MentionSchema],
    default: []
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  isMultipleChoice: {
    type: Boolean,
    default: false
  },
  isClosed: {
    type: Boolean,
    default: false
  },
  closesAt: {
    type: Date,
    default: null
  },
  fromCheckVoters: {
    type: Boolean,
    default: false
  },
  isTracked: {
    type: Boolean,
    default: false
  },
  trackedAt: {
    type: Date,
    default: null
  },
  total_voter_count: {
    type: Number,
    default: 0
  },
  originalPollId: {
    type: String,
    index: true,
    sparse: true
  }
}, {
  timestamps: true
});

// Indexes for efficient lookups
PollSchema.index({ chatId: 1, messageId: 1 }, { unique: true });
PollSchema.index({ pollId: 1 }, { sparse: true });

/**
 * Add a vote to a poll option
 * @param {Number} optionIndex - Index of the option to vote for
 * @param {Number} userId - Telegram user ID of the voter
 * @returns {Promise<Boolean>} - Whether the vote was successful
 */
PollSchema.methods.addVote = async function(optionIndex, userId) {
  if (this.isClosed) {
    return false;
  }
  
  if (optionIndex < 0 || optionIndex >= this.options.length) {
    return false;
  }
  
  // If not multiple choice, remove previous votes
  if (!this.isMultipleChoice) {
    this.options.forEach(option => {
      // Remove only this user's vote, keep placeholders and other users' votes
      option.voterIds = option.voterIds.filter(id => {
        // Remove this user's ID
        if (id === userId) return false;
        // Keep all other IDs (negative placeholders and positive user IDs)
        return true;
      });
    });
  }
  
  // Add vote if not already voted for this option
  if (!this.options[optionIndex].voterIds.includes(userId)) {
    this.options[optionIndex].voterIds.push(userId);
  }
  
  // Update mention status if user is in mentions
  const mentionIndex = this.mentions.findIndex(mention => mention.userId === userId);
  if (mentionIndex !== -1) {
    this.mentions[mentionIndex].voted = true;
  }
  
  await this.save();
  return true;
};

/**
 * Check if all mentioned users have voted
 * @returns {Boolean} - Whether all mentioned users have voted
 */
PollSchema.methods.allMentionsVoted = function() {
  if (this.mentions.length === 0) {
    return true;
  }
  return this.mentions.every(mention => mention.voted);
};

/**
 * Get list of mentions that haven't voted yet
 * @returns {Array} - Array of mentions that haven't voted
 */
PollSchema.methods.getPendingMentions = function() {
  return this.mentions.filter(mention => !mention.voted);
};

/**
 * Close the poll
 * @returns {Promise<void>}
 */
PollSchema.methods.close = async function() {
  this.isClosed = true;
  await this.save();
};

/**
 * Static method to get polls created or tracked by a specific user
 * @param {Number} userId - Telegram user ID
 * @param {Boolean} includeTracked - Whether to include tracked polls
 * @param {Number} limit - Maximum number of polls to return
 * @returns {Promise<Array>} Array of polls
 */
PollSchema.statics.getUserPolls = async function(userId, includeTracked = true, limit = 10) {
  // Base query - polls created by user that aren't closed
  const query = {
    isClosed: false,
    $or: [
      { creatorId: userId }
    ]
  };
  
  // If tracking is included, add polls where this user is a mention
  if (includeTracked) {
    // Add a condition for tracked polls
    query.$or.push({
      'mentions.userId': userId
    });
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit);
};

const Poll = mongoose.model('Poll', PollSchema);

module.exports = Poll;