import {loadCases} from '../../scripts/evaluate_tutor.mjs';

const introduction = {id:'practical:v1:N5:introductions:situation', level:'N5'};
const topicQuestion = {lesson:introduction, focus:{kind:'question',index:1}};
const step = (id, message, rubric, check = 'no-welcome', extra = {}) => ({id,message,rubric,check,...extra});
const sequence = (channel, id, steps, context = {}) => ({channel,id,level:'N5',steps,...context});

// Fresh sequences are for comparison, not prompt examples or tuning data.
const heldOut = [
  sequence('chat','intro-continuity',[
    step('start','Em muốn tập tự giới thiệu từng phần; đầu tiên thầy hỏi tên em thôi nhé.',
      'A brief opening is allowed. Ask only for the name, not hometown or job; do not answer for the learner.','',{action:'start'}),
    step('name','マイです。','Accept the short, natural name answer. Do not require 私は or grade missing details that were not asked for.'),
    step('recall','Em vừa xưng tên gì bằng tiếng Nhật? Chỉ nhắc lại tên em nói thôi, chưa sang phần quê quán.',
      'Use the actual learner text: マイ. No invented personal information, new drill, or evaluation of pronunciation.')
  ],{lesson:introduction}),
  sequence('chat','meaning-then-detail',[
    step('meaning','Trong そろそろ帰ります, そろそろ có ý gì? Em chỉ cần hiểu nhanh câu đó.',
      'Explain in brief Vietnamese that it is about time to leave/go home; no quiz or unrelated Japanese.'),
    step('contrast','Giờ thầy nói kỹ hơn giúp em: nếu thay từ đó bằng もう thì sắc thái đổi thế nào trong câu này?',
      'Compare the two forms in the same sentence. もう帰ります can signal leaving now/already at this point; it does not mean already went home. Do not give a universal equivalence.'),
    step('paraphrase','Vậy trường hợp sắp đến giờ về, không phải đã về, em hiểu sao? Nói bằng tiếng Việt thôi, không cần chữ Nhật.',
      'Confirm the timing in Vietnamese only; no technical recap or extra exercise.','vietnamese-only')
  ]),
  sequence('chat','correction-and-retry',[
    step('correct','Em muốn nói hôm qua không đi bưu điện: 昨日、郵便局へ行きませんです。 Thầy chỉ chỗ sai rồi cho em thử lại cùng câu.',
      'Fix the verb ending to 行きませんでした, keeping yesterday, destination, negation, and politeness. Give one short reason and invite a retry of the same sentence.'),
    step('retry','昨日、郵便局に行きませんでした。','Recognize the fixed polite past negative and accept に as a valid destination marker instead of へ.'),
    step('variant','Em đổi へ thành に thì ý chính có đổi không thầy? Không cần bảo em viết lại nếu vẫn đúng.',
      'Explain that the core destination meaning is unchanged here. Optional direction-versus-destination nuance; no new correction or retry.')
  ]),
  sequence('chat','chip-assent-switch',[
    step('situation','Cho em một tình huống mua vé tàu ở quầy. Thầy vào vai nhân viên, còn em làm khách nhé.',
      'Set one specific ticket-counter situation and make one opening move without supplying the learner’s answer.','no-welcome',{action:'situation'}),
    step('assent','Ừ, em thử nha.','Treat assent in the context of the ticket roleplay. Continue the exchange or give a single actionable turn; do not greet again.'),
    step('switch','Thôi mình không mua vé nữa. Thầy chỉ em cách hỏi mấy giờ thư viện đóng cửa bằng tiếng Nhật, không cần nhập vai.',
      'Drop the ticket goal. Provide a natural library closing-time question (e.g. 図書館は何時に閉まりますか), not the opening time or a new roleplay.')
  ]),
  sequence('live','intro-continuity',[
    step('start','Thầy hỏi em tên gì để em tự giới thiệu bằng tiếng Nhật nhé. Chỉ phần tên thôi.',
      'Ask the name only and stop so the learner can answer; no name model or broader introduction drill.'),
    step('name','ハーです。','Accept the given short name introduction as a response to the question. Do not guess pronunciation from text.'),
    step('recall','Cái tên em vừa nói đó, thầy nhắc lại đúng tên thôi nhé, đừng hỏi tiếp.',
      'Use ハー as supplied, not a guessed name or one from the canonical lesson. Do not turn this into a new exercise.')
  ],{lesson:introduction}),
  sequence('live','meaning-then-detail',[
    step('meaning','Trong バスはまだ来ていません thì chữ まだ nghĩa gì? Thầy giải thích nhanh thôi.',
      'Explain that the bus has not arrived yet. Keep it brief and do not turn the explanation into practice.'),
    step('contrast','Em muốn nghe kỹ hơn. So sánh まだ với もう bằng hai ví dụ nói cùng một chuyến xe đi thầy.',
      'Contrast not-yet with already-arrived in the same setting, using correct polarity and two short Japanese examples.'),
    step('paraphrase','Nếu nó vừa đến rồi, em đang báo việc đã xảy ra hay vẫn đang chờ? Nói bằng tiếng Việt thôi, đừng đọc chữ Nhật.',
      'Answer that it has already happened, not that they are still waiting. Vietnamese only; no extraneous examples.','vietnamese-only')
  ]),
  sequence('live','correction-and-retry',[
    step('correct','Em muốn nói phòng hôm qua không yên tĩnh: 昨日、部屋は静かないです。 Thầy sửa đúng ý giúp em rồi cho em nói lại.',
      'Give a valid polite negative past of 静か, such as 静かじゃなかったです. Keep the room, past and negation; briefly diagnose the form and invite a retry of the same sentence.'),
    step('retry','昨日、部屋は静かじゃなかったです。','Accept the corrected sentence as natural in polite conversation; do not falsely require a more formal variant.'),
    step('register','Nếu nói với quản lý ký túc xá thì đuôi lịch sự, trang trọng hơn một chút là gì? Vẫn là không yên tĩnh hôm qua nhé.',
      'Offer a more formal variant such as 静かではありませんでした without flipping tense or polarity or mislabeling the earlier sentence as wrong.')
  ]),
  sequence('live','chip-assent-interrupt-switch',[
    step('start','', 'Honor the Start chip on the open introductory lesson. Ask one short introduction question and stop.','',{action:'start'}),
    step('assent','うん、やってみます。','Read this as willingness, not a completed answer. Continue or briefly repeat one concrete introduction cue without another greeting.'),
    step('switch','Đoạn vừa rồi em dừng giữa chừng. Bỏ phần giới thiệu nha; em chỉ cần hỏi nhà vệ sinh ở đâu trong nhà ga bằng tiếng Nhật.',
      'Prior assistant text is partial and playback was interrupted; do not assume the learner heard it or completed a task. Honor the new goal despite the still-open lesson: give a natural station restroom question with at most a short explanation.',
      'no-welcome',{interruptPrevious:true})
  ],{lesson:introduction})
];

const topicLeak = 'withhold-topic-particle';
const noDrill = 'Acknowledge a bare greeting briefly; do not introduce yourself, reopen the lesson or assign practice.';
const noFishAnswer = 'Keep the meaning “does not like fish”; explain that 好き is not a verb. Respect the hint-only request; cue the same sentence without giving its complete correction.';
const spokenVariant = 'Accept 何も勉強してません as natural spoken Japanese; the fuller していません is an optional register contrast, not a mandatory correction.';
const exposed = ['chat','live'].flatMap(channel=>[
  sequence(channel,'bare-greeting',[step('greet','hi',noDrill,'greeting')],{lesson:introduction}),
  sequence(channel,'same-sentence-repair',[step('hint','Em muốn nói là không thích cá. Em thử: 魚がすきません。 Thầy chỉ gợi ý để em tự sửa câu này, chưa đưa cả câu nhé.',noFishAnswer)]),
  sequence(channel,'spoken-contraction',[step('check','Thầy xem câu này có tự nhiên khi nói không: 何も勉強してません。',spokenVariant,'spoken-variant')])
]).concat([
  sequence('live','assent',[step('agree','うん。','Continue the shopping roleplay in simple Japanese without repeating the permission request or adding a translation.','no-welcome',{
    history:[{role:'assistant',text:'お店で買い物の練習をしましょうか。'}]
  })]),
  sequence('live','unclear-transcript',[step('clarify','えっと… [không rõ]','Ask for the unclear part again; do not infer a full attempt, grade it, or start a drill.')]),
  sequence('live','japanese-only',[step('meaning','この文の「から」はどんな意味ですか。ベトナムから来ました。','Explain the place of origin in simple Japanese only, without unrelated meanings or quizzes.','japanese-only')],{japaneseOnly:true}),
  sequence('live','pre-answer',[step('hint','','Offer a small strategy without naming the particle or completing the sentence.',topicLeak,{action:'hint'})],topicQuestion),
  sequence('live','valid-variant',[step('check','「水を飲みたいです」 có tự nhiên không? Em chỉ muốn hỏi chữ を.','Accept を and optional が; do not imply that the person already drank water.')]),
  sequence('live','evidence-recap',[step('summary','','Use the actual direction question to summarize; do not invent errors or grade pronunciation.','no-welcome',{
    action:'summary',history:[{role:'user',text:'すみません、郵便局はどこですか。'}]
  })]),
  sequence('live','request-detail',[step('contrast','Thầy giải thích kỹ giúp em điểm khác nhau giữa 〜たい và 〜た. Em hay nhầm muốn làm với đã làm.','Explain the contrast in Vietnamese with a pair using the same verb. Avoid an unrelated exercise.')])
]);

// Independent follow-up dialogues, frozen after the initial repeat-question failure was exposed.
const confirmation=[
  sequence('chat','onsen-time',[
    step('ask','Mình đóng vai ở quầy nhà tắm nhé. Thầy chỉ hỏi em đặt lịch mấy giờ, để em tự trả lời.','Ask one time question, without suggesting or guessing a time.'),
    step('answer','午後四時です。','Accept 4 pm as the answer. Do not greet again, ask for the time again, or correct a valid expression.'),
    step('recall','Em vừa hẹn mấy giờ? Cho em đúng giờ bằng số thôi, không hỏi gì thêm.','Return only 4 pm/16:00. No address, extra question, or inferred details.')
  ]),
  sequence('chat','train-departed',[
    step('meaning','電車はもう出ました nghĩa là sao, thầy nói gọn bằng tiếng Việt thôi.','Explain that the train has already departed. No unnecessary Japanese or drill.','vietnamese-only'),
    step('contrast','Nếu muốn bảo tàu sắp chạy thì dùng もうすぐ được không? Lần này thầy cho em một câu Nhật để đối chiếu.','Contrast already departed with soon to depart, keeping the subject and correct tense.'),
    step('close','Em hiểu rồi, thầy đừng giao bài thêm nhé.','Acknowledge without a drill, question, fabricated attempt or second greeting.')
  ]),
  sequence('live','roleplay-date',[
    step('ask','Em tập gọi điện đặt phòng nhé. Thầy chỉ hỏi ngày em sẽ đến, để em trả lời.','Ask only for the arrival date. No introductory speech or invented reservation data.'),
    step('answer','五月三日です。','Accept May 3. Do not ask again for the date, introduce yourself, or manufacture an error.'),
    step('recall','Thầy nhắc đúng ngày em vừa nói bằng tiếng Việt thôi, đừng hỏi thêm.','Recall May 3 in Vietnamese, not March 5. No new booking question.','vietnamese-only')
  ]),
  sequence('live','station-correction',[
    step('correct','Em muốn nói hôm qua nhà ga không náo nhiệt: 昨日、駅はにぎやかくなかったです。 Thầy chỉ sửa cách chia từ, để em nói lại.','Preserve tense, polarity and target. Give a valid negative past of にぎやか; do not mislabel it as an い-adjective or substitute a different exercise.'),
    step('retry','昨日、駅はにぎやかじゃなかったです。','Accept the polite conversational negative past. Do not require a different register or invent an error.'),
    step('switch','Giờ em muốn hỏi nhà ga có thang máy không. Thầy cho đúng một câu hỏi tiếng Nhật thôi nhé.','Drop the old exercise. Give one relevant Japanese elevator-availability question, no Vietnamese padding.','japanese-only')
  ])
];

const transfer=[
  sequence('chat','cafe-quantity',[
    step('request','Em đóng vai khách mua cà phê mang về. Thầy làm người bán và chỉ hỏi em lấy mấy ly nhé.','Ask only how many, in the role of seller.'),
    step('answer','二つです。','Accept the contextual quantity two. Do not demand a full sentence or say it was wrong.'),
    step('recall','Thầy nhắc số ly em vừa gọi, chỉ viết một chữ số thôi.','Return only the digit 2, no words, units, greeting or new question.')
  ]),
  sequence('chat','window-state',[
    step('meaning','窓が開いています ở đây nghĩa là gì? Chỉ nói bằng tiếng Việt cho em dễ hiểu.','Explain that the window is open, not that someone is in the middle of opening it. Vietnamese only; no drill.','vietnamese-only'),
    step('detail','Lần này cho em biết kỹ hơn vì sao không nhất thiết là ai đó đang mở cửa sổ. Lấy một ví dụ cùng kiểu nhé.','Explain resultant state with an intransitive change-of-state verb; include one relevant example without a categorical rule for all verbs.'),
    step('close','Rõ rồi thầy. Mình dừng ở đây, em không muốn làm bài nữa.','End naturally with no further exercise, quiz or invitation to practise.')
  ]),
  sequence('live','bus-destination',[
    step('request','Thầy làm nhân viên bán vé xe buýt nhé. Chỉ hỏi em điểm đến.','Ask for the destination only; wait for the learner.'),
    step('answer','奈良までです。','Accept Nara as the destination. Do not ask again where, or require a longer answer.'),
    step('recall','Nhắc đúng điểm đến vừa rồi bằng tiếng Việt thôi, không cần hỏi thêm thầy nhé.','Give Nara in Vietnamese script without a Japanese restatement or new question.','vietnamese-only')
  ]),
  sequence('live','convenient-town',[
    step('correct','Năm ngoái thị trấn này không tiện. Em nói 去年、この町は便利くありませんでした。 Em nhầm chỗ nào?','Correct the predicate to 便利ではありませんでした or a valid equivalent. Explain the な-adjective stem directly without inserting な.'),
    step('retry','去年、この町は便利ではありませんでした。','Accept the corrected polite past negative. Do not manufacture an error or move to an unrelated exercise.'),
    step('switch','Không luyện câu đó nữa. Cho em đúng một câu tiếng Nhật để hỏi bến xe buýt gần nhất ở đâu thôi.','Give one natural Japanese question asking where the nearest bus stop is. No Vietnamese preface or follow-up.','japanese-only')
  ])
];

export const casePacks = ['development','held-out','confirmation','transfer','reserved-continuity'];
export const turnId = (item, step) => `${item.channel}/${item.id}/${step.id}`;

export async function selectCases(pack) {
  if (pack==='held-out') return heldOut;
  if (pack==='confirmation') return confirmation;
  if (pack==='transfer') return transfer;
  if (pack==='reserved-continuity') return heldOut.filter(item=>item.channel==='chat'
    ? item.id==='chip-assent-switch' : item.id==='chip-assent-interrupt-switch');
  if (pack!=='development') throw new Error('Unknown tutor evaluation pack.');
  const previous = new Set(['first-hint','no-answer-after-attempt','correct-variant','partial-subgoal']);
  const reused = (await loadCases()).filter(item=>previous.has(item.id)).map(item=>sequence('chat',item.id,
    item.steps.map(row=>step(row.id,row.message,row.expected_behavior.join(' '),item.focus?.kind==='question' ? topicLeak : '',{action:row.intent})),
    {level:item.level, lesson:item.lesson, focus:item.focus, rubric:item.rubric}));
  return [...reused,...exposed];
}

export function turnInput(item, step, task, history) {
  const shared = {lesson:item.lesson ?? null,focus:item.focus ?? null,...(task ? {task:{id:task.task_id,revision:task.revision}} : {})};
  if (item.channel==='chat') return {...shared,channel:'quick',intent:step.action ?? 'message',message:step.message,
    screen:{route:`/tutor-eval/${item.id}`,level:item.level}};
  let prior = step.history ?? history;
  if (step.interruptPrevious) {
    const last = prior.at(-1);
    if (last?.role!=='assistant') throw new Error('No assistant response to interrupt.');
    const text = Array.from(last.text).slice(0,18).join('').trim();
    prior = [...prior.slice(0,-1),{role:'assistant',text,generation:'partial',playback:'interrupted'}];
  }
  return {...shared,level:item.level,command:step.action ?? null,transcript:step.action ? '' : step.message,
    history:prior,japanese_only:item.japaneseOnly===true};
}

export function nextHistory(input, reply) {
  const trim = text=>text.slice(0,600).replace(/[\uD800-\uDBFF]$/u,'');
  return [...input.history,...(input.transcript ? [{role:'user',text:trim(input.transcript)}] : []),
    {role:'assistant',text:trim(reply),generation:'complete'}].slice(-12);
}
