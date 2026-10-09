const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BOT_VERSION } = require('../config/config');
const logger = require('../config/logger');
const { safeMarkdownField } = require('../utils/text');

const answers = [
  // ── classic ──
  'It is certain.', 'It is decidedly so.', 'Without a doubt.',
  'Yes — definitely.', 'You may rely on it.', 'As I see it, yes.',
  'Most likely.', 'Outlook good.', 'Yes.',
  'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  "Don't count on it.", 'My reply is no.', 'My sources say no.',
  'Outlook not so good.', 'Very doubtful.',
  'The omens are good.', 'Destiny smiles upon you.', 'The answer is clear.',
  'Trust the process.', 'The universe nods.', 'Everything will fall into place.',
  'Now is the time.', 'The signs are aligned.', 'Take a leap of faith.',
  'The path is lit.', 'Your guides agree.', 'The answer is blowing in the wind.',

  // ── affirmative ──
  'Absolutely.', 'Indeed.', 'Of course.', 'Naturally.', 'Certainly.',
  'Undoubtedly.', 'Unquestionably.', 'Indubitably.', 'Positively.', 'Assuredly.',
  'The answer is yes.', 'All signs say yes.', 'No doubt about it.',
  'You can count on it.', 'Count on it.', 'It will happen.',
  'Success awaits.', 'Fortune favors you.', 'The time is right.',
  'Go for it.', 'Take the chance.', 'Why not?',
  'By all means.', 'Without question.', 'You have my blessing.',
  'The stars align.', 'Destiny agrees.', 'Everything points to yes.',
  'A resounding yes.', 'It is meant to be.', 'The universe agrees.',
  'Proceed with confidence.', 'Your intuition is right.',
  'The answer you seek is yes.', 'This is your moment.',
  'Seize the opportunity.', 'Luck is on your side.',
  'The path is clear.', 'All obstacles will fade.', 'Victory is yours.',
  'Yes, without hesitation.', 'The answer is a clear yes.', 'Go ahead.',
  'Make it happen.', 'The time is now.', 'You have nothing to lose.',
  'Everything is in your favor.', 'Circumstances are ideal.', 'The foundation is solid.',
  'Build on it.', 'Move forward boldly.', 'Do not second-guess yourself.',
  'Your plan is sound.', 'The outcome will be positive.', 'Expect good news.',
  'Rejoice — the answer is yes.', 'Celebrate in advance.', 'The hard part is over.',
  'Green light.', 'Full speed ahead.', 'No obstacles in sight.',
  'The energy is right.', 'Your aura is bright.', 'Karma is on your side.',
  'Yes, and then some.', 'More than you hoped for.', 'Exceedingly so.',
  'In your favor.', 'The scales tip toward yes.', 'Better than expected.',
  'A golden opportunity.', 'The door is open.', 'Walk through it.',
  'Your patience pays off.', 'The wait was worth it.', 'Everything lines up.',

  // ── strong affirmative ──
  'No question about it.', 'Set it in stone.', 'Write it down.',
  'Guaranteed.', 'Sure as the sun rises.', 'Inexorable.',
  'Inevitable.', 'Predestined.', 'Fate has decided.',
  'The cosmos says yes.', 'The oracle confirms.', 'You have cosmic approval.',
  'Blessed by the stars.', 'Divine intervention says yes.', 'Heaven agrees.',
  'Absolutely positively.', 'Without a shadow of doubt.', 'Crystal clear.',
  'Screaming yes from the rooftops.', 'As sure as gravity.', 'Bank on it.',
  'Irrefutably yes.', 'Case closed.', 'End of discussion.',
  'Non-negotiable yes.', 'Definitively.', 'Conclusively yes.',
  'Signed, sealed, delivered.', 'Locked and loaded.', 'Ready to go.',
  'The universe conspires for you.', 'Everything is aligned.', 'Destiny beckons.',

  // ── negative ──
  'Not a chance.', 'No way.', 'Negative.', 'Never.', 'Not happening.',
  'Forget it.', 'Don\'t even think about it.', 'Save your energy.',
  'The answer is no.', 'All signs say no.', 'Better luck next time.',
  'Not in this lifetime.', 'Don\'t hold your breath.',
  'The stars say no.', 'Fate says no.', 'It\'s not meant to be.',
  'Give up on that.', 'Move on.', 'Let it go.', 'Nope.',
  'Absolutely not.', 'I wouldn\'t count on it.', 'Waste of time.',
  'Not today.', 'Maybe never.', 'The timing is wrong.',
  'This is a bad idea.', 'You will regret this.', 'Don\'t do it.',
  'Stop while you\'re ahead.', 'Have you lost your mind?', 'Think twice.',
  'The outcome is grim.', 'Failure is likely.', 'Not worth the risk.',
  'Back out while you can.', 'The odds are against you.',
  'This ends badly.', 'You have been warned.', 'I sense disaster.',
  'Red flags everywhere.', 'Proceed with caution.', 'Abort mission.',
  'Take a step back.', 'Reconsider everything.', 'Not the right path.',
  'The answer is a firm no.', 'Case closed on this one.', 'Drop it.',
  'Walk away.', 'Cut your losses.', 'Do not look back.',
  'Save yourself the trouble.', 'Not your finest idea.', 'A hard pass.',
  'Rejected.', 'Denied.', 'Dismissed.',
  'The universe says no.', 'The cosmos objects.', 'The stars forbid it.',
  'Bad omen.', 'Bad timing.', 'Bad idea all around.',
  'You will thank me later. No.', 'Trust me on this one. No.',
  'This is not the way.', 'Wrong direction.', 'Dead end ahead.',
  'Spare yourself.', 'Don\'t go there.', 'Put it on hold.',
  'Under no circumstances.', 'Not now, not ever.', 'Cancel the plan.',
  'Redirect your energy.', 'Choose something else.', 'This one is off the table.',
  'Back to the drawing board.', 'Nice try — but no.', 'Appreciate the effort — still no.',

  // ── strong negative ──
  'Impossible.', 'Out of the question.', 'Not under any condition.',
  'When pigs fly.', 'When hell freezes.', 'Not in a million years.',
  'Over my dead body.', 'Absolutely out.', 'Zero chance.',
  'Fat chance.', 'Slim to none.', 'Nonexistent.',
  'Permanently no.', 'Irrevocably no.', 'Final answer: no.',
  'Do not even dream of it.', 'Delete that thought.', 'Erase that idea.',
  'No means no.', 'Hard no.', 'Emphatically no.',

  // ── neutral ──
  'Who knows?', 'Only time will tell.', 'The future is unclear.',
  'It is uncertain.', 'Maybe.', 'Perhaps.', 'Could be.',
  'Possibly.', 'Hard to say.', 'Can\'t tell yet.',
  'In due time.', 'Not sure yet.', 'Wait and see.',
  'The answer will come.', 'Patience.', 'Focus on something else.',
  'It depends on you.', 'Only you can decide.', 'Trust your gut.',
  'Think carefully.', 'You already know.', 'Follow your heart.',
  'The signs are mixed.', 'Fate is undecided.', 'Maybe someday.',
  'The answer is out there.', 'Keep searching.', 'Not the right question.',
  'Ask a different question.', 'The truth is hidden.', 'Look deeper.',
  'It is complicated.', 'The jury is out.', 'Time will reveal all.',
  'The universe is silent.', 'The spirits are quiet.', 'The cards are unclear.',
  'Pause and reflect.', 'Consider your options.', 'Weigh both sides.',
  'The answer changes daily.', 'No one knows for sure.', 'It is a mystery.',
  'The stars are cloudy.', 'Fate is sleeping.', 'The future is foggy.',
  'Reconsider your path.', 'Ask yourself first.', 'The answer lies within.',
  'It could go either way.', 'Prepare for anything.', 'Expect the unexpected.',
  'Ask me tomorrow.', 'Come back later.', 'Not the time.',
  'That is above my pay grade.', 'The signal is weak.', 'Static on the line.',
  'I\'m getting mixed signals.', 'Cannot compute.', 'Processing... try again.',
  'The crystal ball is foggy.', 'The connection is poor.', 'Bad reception.',
  'Check back soon.', 'Pending further info.', 'Results are inconclusive.',
  'The pieces are still moving.', 'The situation is fluid.', 'Too early to tell.',
  'Let it marinate.', 'Sleep on it.', 'Time is your friend.',
  'Both paths are valid.', 'Neither is wrong.', 'The choice is yours.',
  'The answer is evolving.', 'Details are emerging.', 'Stand by.',
  'Not enough data.', 'Insufficient information.', 'Need more context.',
  'The pendulum is swinging.', 'The tide is turning.', 'Change is coming.',
  'Neutral territory.', 'No clear direction.', 'On the fence.',
  'It is what it is.', 'C\'est la vie.', 'Que sera, sera.',
  'Such is life.', 'Roll the dice.', 'Flip a coin.',
  'Go with the flow.', 'Take it as it comes.', 'Whatever happens, happens.',
  'The universe is weighing options.', 'Fate is consulting.', 'Destiny is deliberating.',

  // ── tình yêu ──
  'Love is certain.', 'Your heart knows the answer.', 'They feel the same.',
  'Love will find a way.', 'Not the one — keep looking.',
  'Love is near.', 'This love is real.', 'Let love in.',
  'Timing isn\'t right for love.', 'Love is worth the risk.',
  'They are thinking of you.', 'Love is on the horizon.', 'Your soulmate is close.',
  'The heart wants what it wants.', 'Follow your heart, not your head.',
  'Love is patient, love is kind.', 'This too shall pass — but the love remains.',
  'Second chances exist in love.', 'True love never fades.',
  'A love letter is coming your way.', 'An old flame may return.',
  'Do not rush love.', 'Let love find you naturally.',
  'Your ex is not the one.', 'New love is entering your life.',
  'Love yourself first.', 'The right one will stay.',
  'Chemistry is real between you.', 'The spark is mutual.',
  'Distance means nothing for true love.', 'This relationship will grow stronger.',
  'Trust your partner.', 'Communication is key.',
  'A confession is coming.', 'Someone has a crush on you.',
  'Love is a journey, not a destination.', 'Cherish every moment together.',
  'Sometimes love means letting go.', 'Do not settle for less.',
  'The love you give returns to you.', 'You deserve to be loved.',
  'A proposal may be coming.', 'Wedding bells in the distance.',
  'Lovers\' quarrel — but you\'ll make up.', 'It is not the end.',
  'They miss you too.', 'Reach out to them.',

  // ── proverbs ──
  'A journey of a thousand miles begins with a single step.',
  'What doesn\'t kill you makes you stronger.',
  'This too shall pass.', 'Nothing ventured, nothing gained.',
  'Fortune favors the bold.', 'Carpe diem.',
  'Every cloud has a silver lining.', 'When one door closes, another opens.',
  'Patience is a virtue.', 'The early bird catches the worm.',
  'Better late than never.', 'Actions speak louder than words.',
  'Where there\'s a will, there\'s a way.',
  'Rome wasn\'t built in a day.', 'All good things come to those who wait.',
  'The pen is mightier than the sword.', 'Honesty is the best policy.',
  'Practice what you preach.', 'Birds of a feather flock together.',
  'The squeaky wheel gets the grease.', 'Necessity is the mother of invention.',
  'Knowledge is power.', 'Time heals all wounds.',
  'Life is what you make it.', 'The only constant is change.',
  'Yesterday is history, tomorrow is a mystery.',
  'In the middle of difficulty lies opportunity.',
  'The only way out is through.', 'Keep your friends close.',
  'To be or not to be — that is the question.',
  'All that glitters is not gold.',
  'What goes around comes around.', 'Every ending is a new beginning.',
  'The best things in life are free.', 'Home is where the heart is.',
  'Be the change you wish to see.', 'Dream big.',
  'The truth will set you free.', 'Haste makes waste.',
  'Two heads are better than one.', 'Don\'t put all your eggs in one basket.',
  'A friend in need is a friend indeed.',
  'The grass is always greener on the other side.',
  'You can\'t judge a book by its cover.',
  'If it ain\'t broke, don\'t fix it.', 'Strike while the iron is hot.',
  'Absence makes the heart grow fonder.',
  'Out of sight, out of mind.', 'Easy come, easy go.',

  // ── fun ──
  '42.', 'The answer is always 42.', 'Ask Deep Thought.',
  'I\'m not saying no, but I\'m not saying yes either.',
  'The odds are 50/50 — either it happens or it doesn\'t.',
  'Statistically speaking, maybe.', 'In a parallel universe, yes.',
  'The simulation says... error.', 'This reality does not support that action.',
  'Have you tried turning it off and on again?',
  'I\'m afraid I can\'t do that.', 'I\'ll be back with an answer.',
  'May the Force be with you.', 'So say we all.',
  'To infinity and beyond!', 'Live long and prosper.',
  'Make it so.', 'Elementary, my dear user.',
  'The cake is a lie.', 'All your base are belong to us.',
  'Sending good vibes.', 'Manifesting your answer.',
  'The vibes are immaculate.', 'Big brain energy says yes.',
  'Chaos theory says... unpredictable.', 'Meow.',
  '* taps the sign * Ask again later.', 'Consult your nearest wizard.',
  'No wtf.', 'Wtf no.', 'STFU.', 'TF are you asking me for?',
  'dnr.', 'idc.', 'idgaf.', 'Bruh.', 'Bruh moment.',
  'Say sike rn.', 'You good?', 'U good bro?', 'Lol no.',
  'Lmao get real.', 'Are you for real?', 'Chill.', 'Touch grass.',
  'Go outside.', 'Bruh wtf.', 'Bro what?', 'Fr? No.',
  '💀', 'Nah.', 'Nah bruh.', 'Nah I\'m good.', 'You what?',
  'Stop it. Get some help.', 'Not now bruh.', 'Go ask someone else.',
  'I\'m not your therapist.', 'I\'m done.', 'Are you kidding me?',
  'Get outta here with that.', 'ain\'t no way.', 'Bet? No.',
  'Who asked?', 'Anyways...', 'So anyway.',
  'I literally cannot rn.', 'Cope.', 'Seethe.', 'Stay mad.',
  'Yes, if you believe hard enough.', 'No, even if you believe.',
  'Maybe — the universe is still deciding.',
  'The data suggests yes, but proceed carefully.',
  'The data suggests no, but exceptions exist.',
  'Look within yourself for the answer.',
  'You already made up your mind.', 'You know what to do.',
  'Stop asking and start doing.', 'The answer is irrelevant.',
  'The question itself is flawed.', 'Try a different approach.',
  'This path leads to growth.', 'This path leads to lessons.',
  'Both outcomes teach you something.', 'You are ready for the truth.',
  'The truth is stranger than fiction.', 'Reality is an illusion.',
  'You create your own reality.', 'Your thoughts shape your future.',
  'Think positive.', 'The energy you put out comes back.',
  'The universe provides.', 'Trust the timing of your life.',
  'Everything happens for a reason.',
  'Some questions have no answers.', 'The answer is in the journey.',
  'Perspective changes everything.',
  'As above, so below.', 'And so it is.',
  'The answer is hidden in plain sight.',
  'You are overthinking this.', 'Keep it simple.',
];

module.exports = {
  public: true,
  data: new SlashCommandBuilder()
    .setName('8ball')
    .setDescription('Ask the Magic 8-Ball a question!')
    .addStringOption(opt =>
      opt.setName('question').setDescription('Your question for the 8-Ball.').setRequired(true).setMaxLength(1024)
    ),

  async execute(interaction, { client }) {
    const question = interaction.options.getString('question');
    const answer = answers[Math.floor(Math.random() * answers.length)];

    logger.info(`8ball: ${interaction.user.tag} asked "${question}" → ${answer}`);

    let ballEmoji = null;
    try {
      const appEmojis = await client.application.emojis.fetch();
      ballEmoji = appEmojis.find(e => e.name === '8ball');
    } catch (_) {}
    const title = `${ballEmoji || ''} Magic 8-Ball`.trim();

    const embed = new EmbedBuilder()
      .setTitle(title)
      .addFields(
        { name: 'Question', value: safeMarkdownField(question, 1024), inline: false },
        { name: 'Answer', value: `**${safeMarkdownField(answer, 100)}**`, inline: false },
      )
      .setColor(0x272730)
      .setFooter({ text: `Bot v${BOT_VERSION}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
