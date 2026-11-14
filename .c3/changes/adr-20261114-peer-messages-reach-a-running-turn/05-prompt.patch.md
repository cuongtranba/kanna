---
target: c3-249
scope: block
base: c3-249#n14780@v1:sha256:5f30dcb859116ca20d3519ad314a4bf9ef156c0530b95a90e713ca611dc3590c
---
| Peer prompt | OUT | renderPeerPrompt wraps the raw text in peer-chat-message with escaped attributes, including the sending run and the message it answers, and a footer saying it is not from the user and how to reply | Applied when the text reaches the model, at turn start or at injection, so the queue and the transcript keep the raw text; a closing tag inside the text is neutralised | src/shared/peer-messaging/render-prompt.ts |
