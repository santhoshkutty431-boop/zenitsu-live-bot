// ─── AI CHAT GAMES MODULE ────────────────────────────────────────────────────
// Handles game sessions for Tic-Tac-Toe, Trivia, and RPGs hosted by ZENITSU AI.

const GAME_SESSIONS = new Map(); // channelId -> session

function getSession(channelId) {
  return GAME_SESSIONS.get(channelId) || null;
}

function startTrivia(channelId, user) {
  const session = {
    type: 'trivia',
    user: user.id,
    userTag: user.tag,
    score: 0,
    round: 1,
    currentQuestion: null,
    answered: false
  };
  GAME_SESSIONS.set(channelId, session);
  return nextTriviaQuestion(session);
}

const TRIVIA_POOL = [
  { q: "What is the capital of France?", a: "paris" },
  { q: "Which planet is known as the Red Planet?", a: "mars" },
  { q: "Who painted the Mona Lisa?", a: "leonardo da vinci" },
  { q: "What is the largest ocean on Earth?", a: "pacific" },
  { q: "What is the chemical symbol for gold?", a: "au" },
  { q: "Which gas do plants absorb from the atmosphere?", a: "carbon dioxide" },
  { q: "Who wrote 'Romeo and Juliet'?", a: "shakespeare" }
];

function nextTriviaQuestion(session) {
  const idx = Math.floor(Math.random() * TRIVIA_POOL.length);
  session.currentQuestion = TRIVIA_POOL[idx];
  session.answered = false;
  return `📝 **Trivia Round ${session.round}**!\n\nQuestion: **${session.currentQuestion.q}**\n\n*Type your answer directly in the chat!*`;
}

function handleTriviaAnswer(session, message) {
  const answer = message.content.toLowerCase().trim();
  if (answer === session.currentQuestion.a) {
    session.score++;
    session.round++;
    if (session.round > 5) {
      GAME_SESSIONS.delete(message.channelId);
      return `🎉 **Correct, ${message.author}!**\n\n🏆 Game Over! You scored **${session.score}/5**!`;
    }
    const response = `✅ **Correct, ${message.author}!** (+1 Point)\n\nTotal Score: **${session.score}**\n\n` + nextTriviaQuestion(session);
    return response;
  } else {
    session.round++;
    const correct = session.currentQuestion.a;
    if (session.round > 5) {
      GAME_SESSIONS.delete(message.channelId);
      return `❌ **Incorrect, ${message.author}!** The correct answer was **${correct}**.\n\n🏆 Game Over! Final Score: **${session.score}/5**!`;
    }
    const response = `❌ **Incorrect, ${message.author}!** The correct answer was **${correct}**.\n\n` + nextTriviaQuestion(session);
    return response;
  }
}

module.exports = {
  getSession,
  startTrivia,
  handleTriviaAnswer,
  GAME_SESSIONS
};
