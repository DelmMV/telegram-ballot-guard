/**
 * English language localization
 */
const en = {
  // Common phrases
  common: {
    welcome: 'Welcome to Ballot Guard Bot!',
    error: 'An error occurred. Please try again later.',
    commandNotUnderstood: 'I didn\'t understand that command. Try /help to see available commands.'
  },
  
  // Welcome message
  welcome: {
    description: 'I help you create polls and keep track of who still needs to vote.',
    groupUsage: 'In group chats you can create polls and mention users who should vote.',
    privateUsage: 'In private chat you can get help and instructions.',
    seeCommands: 'Type /help to see all available commands.'
  },
  
  // Help messages
  help: {
    title: 'Available Commands:',
    commonCommands: {
      help: '/help - Show this help message'
    },
    groupCommands: {
      title: 'Creating Polls:',
      newpoll: '/newpoll Poll Title | Option 1 | Option 2 | ...\nCreate a new poll with the given title and options.\nYou can mention users in the title to track their votes.\nExample: /newpoll Meeting tomorrow @user1 @user2? | Yes | No | Maybe',
      createpoll: '/createpoll\nStart an interactive poll creation wizard with step-by-step guidance.\nThis is the easiest way to create a poll!',

      managingTitle: 'Managing Polls:',
      checkvoters: '/checkvoters [message_id] [option_number] - Check who voted for a specific option and create an additional poll to confirm participation\nSpecify message_id to select a poll and option_number to check voters for that option. The command can be used both in private chat with the bot and in the group.'
    },
    privateCommands: {
      description: 'To use my poll features, add me to a group chat and use the following commands:',
      newpoll: '/newpoll - Create a new poll (text command)',
      createpoll: '/createpoll - Create a new poll (interactive wizard)',

      checkvoters: '/checkvoters - Check who voted for a specific option and create an additional poll to confirm participation. The command can be used both in private chat and in the group',
      trackingInfo: 'I\'ll help you track votes and provide convenient paginated access (5 entries per page) to the list of voters! You can also notify users who voted for a specific option.'
    }
  },
  
  // Poll creation
  poll: {
    groupOnly: 'Polls can only be created in groups or supergroups.',
    provide: 'Please provide poll details:',
    syntax: '/newpoll Poll Title | Option 1 | Option 2 | ...',
    mentionExample: 'You can mention users in the title to track their votes. For example:',
    mentionSample: '/newpoll Meeting tomorrow @user1 @user2?',
    minOptions: 'Please provide at least 2 options for the poll, separated by |',
    createdWith: 'Poll created with {count} mentioned {users}:',
    user: 'user',
    users: 'users',
    checkVoters: 'Use /checkvoters {messageId} [option_number] to check who voted for a specific option.',
    checkVotersExample: 'Example: /checkvoters {messageId} 1 - will show who voted for the first option',
    createError: 'Failed to create poll. Please try again.'
  },
  
  // Scene messages
  scenes: {
    common: {
      backButton: 'Back',
      prevButton: 'Prev',
      nextButton: 'Next',
    },
    track: {
      replyRequired: 'Please reply to a poll message with this command to start tracking it.',
      notAPoll: 'The message you replied to is not a poll. Please reply to a poll message.',
      alreadyTracked: 'This poll (message ID: {messageId}) is already being tracked!',
      success: 'Now tracking poll (message ID: {messageId}): "{question}"\nUse /checkvoters {messageId} to check votes.',
      error: 'Failed to track the poll. Please try again.'
    },
    voters: {
      startingPollCreation: 'Creating poll...',
    },
    poll: {
      titlePrompt: 'Let\'s create a new poll! Please enter the title:',
      titlePlaceholder: 'Enter poll title here...',
      noText: 'Please send a text message.',
      usingImportedMentions: 'I\'ll use {count} users from the selected option "{option}" in your poll.',
      titleWithImportedMentions: 'Your poll title: "{title}" will include the following users:\n{mentions}',
      includedImportedMentions: 'Poll includes {count} users who voted for option "{option}" in the previous poll.',
      mentionsForPoll: '📊 Poll "{title}"\n👥 {mentions}',
      mentionsForCheckVoters: '📊 Checking readiness of participants for the option "{option}" from poll "{originalPollTitle}"\n👥 {mentions}',
      mentionsDetected: 'I detected {count} {users} in your title: {list}',
      combinedPrompt: 'Let\'s create a new poll! Please enter the title for your poll.\n\nAfter that, I\'ll ask you to add options one by one. When you\'re done adding options, type /done or click the Done button.',
      compactPrompt: 'Enter poll title:',
      suggestedTitle: 'Suggested title',
      optionPrompt: 'Please enter option #{count} for your poll:',
      compactOptionPrompt: 'Option #{count}:',
      optionPlaceholder: 'Enter option here...',
      addMoreOrDone: 'Add more options or type /done when finished',
      cannotFinishYet: 'You cannot finish yet. Please complete the current step first.',
      optionAdded: 'Option added: "{option}"',
      compactOptionAdded: 'Options:',
      currentOptions: 'Current options',
      nextOptionPrompt: 'Please enter another option or send /done when finished',
      doneButton: '✅ Done',
      confirmation: 'Please confirm your poll:',
      createButton: '✅ Create Poll',
      cancelButton: '❌ Cancel',
      cancelled: 'Poll creation cancelled',
      cancelledMessage: 'Poll creation was cancelled. You can start over with /createpoll',
      creating: 'Creating your poll...',
      success: 'Poll created successfully!',
      compactSuccess: 'Poll created! Use /checkvoters {messageId} to check votes.',
      // Interactive poll creation strings
      createPollHeader: 'Create Poll',
      titleSection: 'Title',
      optionsSection: 'Options',
      mentionsSection: 'Mentioned Users',
      notSet: '(not set)',
      noOptions: 'No options added yet',
      interactiveHelp: 'Use the buttons below to edit the poll',
      editTitleButton: '✏️ Edit Title',
      editTitlePrompt: 'Enter new poll title:',
      addOptionButton: '➕ Add Option',
      addOptionPrompt: 'Enter option #{count}:',
      editOptionPrompt: 'Edit option "{option}":',
      optionDeleted: 'Option deleted',
      titleRequired: 'Title is required',
      minimumOptionsRequired: 'At least 2 options are required',
      creatingPoll: 'Creating your poll...',
      pollCreated: 'Poll created successfully! Use /checkvoters {messageId} to check votes.',
      welcomeCreatePoll: 'Let\'s create a new poll! Use the buttons below to add a title and options.'
    },
    voters: {
      selectPoll: 'Please select a poll to check voters:',
      selectOption: 'Please select an option to see who voted for it:',
      trackedPollNote: 'Note: This is a tracked poll. Only votes cast after tracking began will be monitored.',
      trackedPollNoVotersYet: 'No votes have been recorded since this poll was tracked. Only new votes will be counted.',
      cancelButton: '❌ Cancel',
      cancelled: 'Operation cancelled',
      cancelledMessage: 'Voter checking was cancelled. You can start over with /checkvoters',
      errorFetchingPolls: 'Error fetching polls. Please try again later.',
      errorFetchingOptions: 'Error fetching poll options. Please try again later.',
      errorShowingVoters: 'Error showing voters. Please try again later.',
      yourPolls: 'Your active polls:',
      pollsInGroup: 'Polls in group',
      errorMarkdown: 'Could not format user list with Markdown. Sending plain text instead.',
      errorShowingUsers: 'Could not display the list of users. Please try again later.',
      errorCreatingPoll: 'Error creating poll from voters. Please try again later.',
      andMoreUsers: '... and {count} more users',
      tooManyVotersForDisplay: 'There are too many voters ({count}) to display in a single message.',
      errorFormattingVoters: 'There was an error formatting the voter list. Some information might be missing.',
      createPollPrompt: '',
      createPollButton: '📊 Create readiness check poll',
      finishButton: '✅ Finish',
      finished: 'Voter checking completed.',
      followUpTitle: 'Follow-up for "{option}"',
      startingNewPoll: 'Let\'s create a new poll with the users who voted for this option.',
      suggestedTitle: 'Suggested title',
      redirectingToCreate: 'Redirecting to poll creation...',
      redirectingSimple: 'Creating new poll...'
    }
  },
  
  // Check voters
  voters: {
    notFound: 'No poll found with message ID {messageId}',
    noActive: 'No active polls found in this chat',
    noOptions: 'This poll doesn\'t have any options to check.',
    invalidOption: 'Invalid option number. Please specify a valid option number from 1 to {count}.',
    noVoters: 'No one has voted for this option: "{option}"',
    optionVoters: 'Voted: {count}',
    list: 'Voters:',
    page: 'Page',
    useToMention: 'You can use these mentions in your next poll:',
    copyForNext: '📋 Copy this to mention all users who voted for this option:',
    usage: 'Usage: /checkvoters [message_id] [option_number]'
  },
  track: {
    replyRequired: 'Please reply to a poll message with this command to start tracking it.',
    notAPoll: 'The message you replied to is not a poll. Please reply to a poll message.',
    alreadyTracked: 'This poll (message ID: {messageId}) is already being tracked!',
    success: 'Now tracking poll (message ID: {messageId}): "{question}"\nUse /checkvoters {messageId} to check votes.',
    error: 'Failed to track the poll. Please try again.'
  },
  
  // Close poll
  close: {
    groupOnly: 'This command can only be used in groups or supergroups.',
    notFound: 'No poll found with message ID {messageId}',
    noActive: 'No active polls found in this chat',
    permissionDenied: 'Only poll creators or chat administrators can close polls.',
    pollClosed: 'Poll "{title}" has been closed.',
    results: 'Results:',
    option: '"{text}": {votes} votes ({percentage}%)',
    allVoted: '✅ All {count} mentioned users voted.',
    someNotVoted: '⚠️ {pending} out of {total} mentioned users did not vote.',
    closeError: 'Failed to close poll. Please try again.'
  }
};

module.exports = en;