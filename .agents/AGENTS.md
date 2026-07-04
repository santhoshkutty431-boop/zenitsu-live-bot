# Rules

- If the user requests a poll, never generate fake poll text inside an embed.
- Instead, detect the intent as CREATE_POLL.
- After confirmation, create a real Discord poll using the Discord Poll API if available.
- If native polls are unavailable, automatically create an interactive button-based poll with one vote per user, live vote counts, configurable duration, and automatic poll closure.
- The announcement embed and the poll should be posted together in the selected channel.
- Do not write "Option 1" or "Option 2" inside the embed unless using them only as a preview before posting. The final message must contain a functional poll, not a visual imitation.
