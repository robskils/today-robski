# The Daybook Guide to A Life Well Lived - a mini-book PDF.
from reportlab.lib.pagesizes import A5
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, PageBreak, FrameBreak, KeepTogether)
from reportlab.lib.styles import ParagraphStyle

PAPER = HexColor('#FBF7EF')   # warm paper
INK   = HexColor('#2B2A28')
MIST  = HexColor('#8A8278')
GOLD  = HexColor('#B0894E')

F = '/System/Library/Fonts/Supplemental/'
pdfmetrics.registerFont(TTFont('Geo', F + 'Georgia.ttf'))
pdfmetrics.registerFont(TTFont('Geo-B', F + 'Georgia Bold.ttf'))
pdfmetrics.registerFont(TTFont('Geo-I', F + 'Georgia Italic.ttf'))
pdfmetrics.registerFont(TTFont('Geo-BI', F + 'Georgia Bold Italic.ttf'))
pdfmetrics.registerFontFamily('Geo', normal='Geo', bold='Geo-B', italic='Geo-I', boldItalic='Geo-BI')

W, H = A5

def bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # page number + running foot
    canvas.setFont('Geo-I', 8.5)
    canvas.setFillColor(MIST)
    if doc.page > 1:
        canvas.drawCentredString(W / 2, 12 * mm, str(doc.page))
    canvas.restoreState()

def cover_bg(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, W, H, fill=1, stroke=0)
    # the Daybook mark: a simple dawn arc + horizon in gold
    cx = W / 2
    y = H - 46 * mm
    canvas.setStrokeColor(GOLD); canvas.setLineWidth(2)
    canvas.setFillColor(GOLD)
    canvas.wedge(cx - 9 * mm, y - 4 * mm, cx + 9 * mm, y + 14 * mm, 0, 180, fill=1, stroke=0)
    canvas.setLineCap(1)
    canvas.line(cx - 13 * mm, y - 4 * mm, cx + 13 * mm, y - 4 * mm)
    canvas.setStrokeColor(HexColor('#D8C39A'))
    canvas.line(cx - 9 * mm, y - 7.5 * mm, cx + 9 * mm, y - 7.5 * mm)
    canvas.restoreState()

styles = {}
styles['h1'] = ParagraphStyle('h1', fontName='Geo-B', fontSize=15, leading=19, textColor=INK, spaceBefore=2, spaceAfter=4)
styles['num'] = ParagraphStyle('num', fontName='Geo-B', fontSize=9, leading=12, textColor=GOLD, spaceAfter=2)
styles['body'] = ParagraphStyle('body', fontName='Geo', fontSize=10.3, leading=16.5, textColor=INK, spaceAfter=8, alignment=TA_LEFT)
styles['quote'] = ParagraphStyle('quote', fontName='Geo-I', fontSize=12.5, leading=18, textColor=INK, leftIndent=10, spaceBefore=4, spaceAfter=2, borderPadding=0)
styles['cite'] = ParagraphStyle('cite', fontName='Geo', fontSize=8.5, leading=12, textColor=MIST, leftIndent=10, spaceAfter=10)
styles['inbook'] = ParagraphStyle('inbook', fontName='Geo', fontSize=9.6, leading=15, textColor=HexColor('#5c5346'), spaceBefore=2, spaceAfter=6, leftIndent=10, rightIndent=6)
styles['inbook_h'] = ParagraphStyle('inbook_h', fontName='Geo-B', fontSize=8.5, leading=11, textColor=GOLD, leftIndent=10, spaceBefore=8, spaceAfter=2)

story = []

def chapter(num, title, quote, cite, paras, inbook):
    blk = []
    blk.append(Paragraph(num, styles['num']))
    blk.append(Paragraph(title, styles['h1']))
    blk.append(Spacer(1, 2))
    if quote:
        blk.append(Paragraph(f'&ldquo;{quote}&rdquo;', styles['quote']))
        blk.append(Paragraph('&mdash; ' + cite, styles['cite']))
    story.append(KeepTogether(blk))
    for p in paras:
        story.append(Paragraph(p, styles['body']))
    story.append(Paragraph('IN DAYBOOK', styles['inbook_h']))
    story.append(Paragraph(inbook, styles['inbook']))
    story.append(PageBreak())

# ---- content ----
CH = [
 ('CHAPTER ONE', 'A life has parts, not projects',
  'The unexamined life is not worth living.', 'Socrates',
  ['Almost every tool for getting organised is built around projects, because it was built for work. But a life is not a project. Forr&oacute; is not a project. Fatherhood is not a project. Your health is not a deliverable with a deadline.',
   'The parts of a life are the few things you would name if a friend asked what actually matters to you &mdash; work, family, a craft, your body, the people you love, the place you live. Name those, and you have a frame that holds everything else.',
   'When your calendar, your money, your notes, your goals and your people all hang from the same small set of life areas, a new question becomes answerable: not <i>how productive was I this week</i>, but <i>what is my life actually made of, and where is it going?</i>'],
  'Everything in Daybook attaches to a <b>life area</b>. A task, a note, an event, a goal, a pound spent &mdash; each belongs to a part of your life, so any area page gathers the whole of that corner in one place.'),

 ('CHAPTER TWO', 'What you hold in awareness, you can steer',
  'We are what we repeatedly do.', 'Aristotle',
  ['There is a quiet mechanism behind almost all deliberate change, and it is simpler than most advice admits: <i>what you bring into awareness, you begin to steer.</i>',
   'You cannot adjust a course you never look at. The spending that drifts, the friendship that goes quiet, the body left untended &mdash; these rarely fail by decision. They fail by inattention. The act of noticing is itself the intervention. Before any plan, before any discipline, simply <b>seeing where things stand</b> changes the next choice you make.',
   'This is why reflection is not a luxury laid on top of a busy life. It is the part that makes the rest coherent. A few honest minutes looking back is worth more than hours of resolve.'],
  'Daybook&rsquo;s <b>reviews</b> exist to put your life in front of you &mdash; each area scored, the week&rsquo;s doing gathered, your own words alongside. Not to grade you. To let you see, so the next week is chosen rather than drifted into.'),

 ('CHAPTER THREE', 'The rhythm of looking back',
  'Every day, in every way, examine yourself.', 'the Stoics, after Epictetus',
  ['Awareness needs a rhythm, or it never happens. Left to chance, the looking-back that matters most is the first thing a full life crowds out.',
   'So it helps to have a cadence: a light glance at the week, a fuller look at the month, a wider one each quarter, and once a year the long view. Each zoom answers a different question. The week asks <i>what happened</i>. The quarter asks <i>am I still pointed the right way</i>. The year asks <i>is this the life I mean to be living</i>.',
   'None of it needs to be heavy. A cadence you actually keep beats an ambitious ritual you abandon by February.'],
  'Daybook offers <b>weekly, monthly, quarterly and yearly reviews</b>, each due on a rhythm you set. They pull in what you did and let you rate how each life area felt, building a Wheel of Life you can watch move over the seasons.'),

 ('CHAPTER FOUR', 'A tool that does not nag',
  'Nature does not hurry, yet everything is accomplished.', 'Lao Tzu',
  ['Most productivity software runs on a small, deliberate cruelty: the streak you must not break, the counter turning red, the badge that says you are behind. This is not an accident of design. Guilt drives engagement, and engagement is the business model.',
   'But guilt is a poor fuel for a life. It gets you to open an app; it does not help you live well. And for anything tender &mdash; a journal, a practice, the state of your health &mdash; being made to feel behind is exactly the wrong beginning.',
   'A missed day is information, not a failure. A skipped rest is a choice, not a debt. The gentler frame is not softer &mdash; it is simply truer to how a good life is actually built: unevenly, forgivingly, over years.'],
  'Daybook has <b>no streaks, no red, no overdue state, nothing that nags</b>. Targets are guidance, never debt. It is built to be a calm place you return to, not a scoreboard you answer to.'),

 ('CHAPTER FIVE', 'You become your practices',
  'The soul becomes dyed with the colour of its thoughts.', 'Marcus Aurelius',
  ['Goals get the attention, but it is <i>practices</i> &mdash; the small things done again and again &mdash; that quietly make a person. You do not rise to the level of your ambitions; you settle to the level of your habits.',
   'A practice is not a task to be finished. It is a way of being, kept warm by repetition: sitting each morning, walking each day, playing an instrument, calling the people you love. The point is not the streak. The point is who you become by doing it.',
   'Held gently, tracked without pressure, practices are how a value stops being an intention and becomes a life.'],
  'Daybook&rsquo;s <b>practices</b> are a palette, not a timetable &mdash; grouped by life area, each with its own guide, video and notes. Tick them as you go; a quiet flame marks the rhythm, never a punishment for a gap.'),

 ('CHAPTER SIX', 'Vision sets the compass',
  'What lies behind us and before us are tiny matters compared to what lies within us.', 'Ralph Waldo Emerson',
  ['A goal without a vision is just a task with ambition. It gets done, and then you wonder why it mattered. The vision is the picture of the area at its best &mdash; the reason the goals underneath it are worth the effort.',
   'Write the vision first, in the present tense, as if it were already so. Then the goals become steps toward something you can see, and the daily actions borrow their meaning from the whole. On a hard week, it is the vision, not the to-do list, that tells you which goal still matters most.'],
  'On every <b>life area</b> you can write a <b>vision</b>, set <b>goals</b> beneath it, and break those into actions. Your reviews then ask each goal a simple question: how is it going, against the vision you set?'),

 ('CHAPTER SEVEN', 'The dots want joining',
  'The whole is greater than the sum of its parts.', 'Aristotle',
  ['The real problem was never any single tool. It was the space <i>between</i> them &mdash; the inbox that did not know your calendar, the budget that did not know your goals, the journal that did not know your week. Life is lived in the crossings, but our software keeps them apart, and the switching becomes the work.',
   'When the pieces share a spine, something changes. An email becomes a task on a life area. A calendar event feeds a practice. Money spent lands against the part of life it served. Nothing has to be re-entered, re-filed, re-remembered. The overwhelm of a five-app stack was never the amount of stuff &mdash; it was the seams.'],
  'In Daybook the tools <b>talk to each other</b>. File an email to an area and it joins that area&rsquo;s page; a task ticked appears in your review; a practice kept feeds the read of your week. Join the dots, without the overwhelm.'),

 ('CHAPTER EIGHT', 'Room to reflect',
  'Knowing yourself is the beginning of all wisdom.', 'Aristotle',
  ['A life well lived is not only organised; it is <i>felt</i>, and made sense of. There has to be somewhere for the inner life to go &mdash; the dream worth keeping, the question you are sitting with, the day you want to remember, the reading that steadies you.',
   'Reflection is where experience turns into understanding. Without it, a life is just one thing after another; with it, the same events become a story you can learn from. This is slower work, and quieter, and it does not show up on any dashboard &mdash; which is exactly why a tool that respects it is rare.'],
  'Daybook&rsquo;s <b>Well-being</b> gathers the reflective practices in one place &mdash; journalling with a prompt to dig deeper, a meditation timer, dreams, and the older mirrors of the I&nbsp;Ching and the day&rsquo;s reading &mdash; each attached to the life it belongs to.'),

 ('CHAPTER NINE', 'Attention is the substance of life',
  'My experience is what I agree to attend to.', 'William James',
  ['In the end, a life is made of what you pay attention to. The hours go where attention goes, and the hours are the life. This is not a metaphor &mdash; it is the plainest fact there is, and the easiest to forget in a week that fills itself.',
   'To live well, then, is largely to attend well: to keep the few things that matter in view, and to let the rest fall quiet. Not to do more, but to notice sooner &mdash; to catch the drift while it is still small, and to spend your days, deliberately, on the life you actually want.'],
  'That is the whole intent of Daybook: to hold what matters gently in view, organised by the life it belongs to, so your attention lands where you mean it to. Not a fuller life. A more <i>aware</i> one.'),
]

for c in CH:
    chapter(*c)

# ---- build ----
def build():
    doc = BaseDocTemplate('daybook-guide.pdf', pagesize=A5,
                          leftMargin=18*mm, rightMargin=18*mm, topMargin=20*mm, bottomMargin=18*mm,
                          title='The Daybook Guide to A Life Well Lived', author='Daybook')
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='body')
    cover_frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='cover')
    doc.addPageTemplates([
        PageTemplate(id='cover', frames=[cover_frame], onPage=cover_bg),
        PageTemplate(id='body', frames=[frame], onPage=bg),
    ])
    # cover story
    cover = []
    cover.append(Spacer(1, 60*mm))
    cover.append(Paragraph('The Daybook Guide to', ParagraphStyle('ct', fontName='Geo-I', fontSize=15, leading=20, textColor=MIST, alignment=TA_CENTER)))
    cover.append(Spacer(1, 4))
    cover.append(Paragraph('A Life Well Lived', ParagraphStyle('ct2', fontName='Geo-B', fontSize=30, leading=34, textColor=INK, alignment=TA_CENTER)))
    cover.append(Spacer(1, 8*mm))
    cover.append(Paragraph('On awareness, the parts of a life,<br/>and joining the dots.', ParagraphStyle('cs', fontName='Geo-I', fontSize=12, leading=18, textColor=INK, alignment=TA_CENTER)))
    cover.append(Spacer(1, 40*mm))
    cover.append(Paragraph('DAYBOOK', ParagraphStyle('cb', fontName='Geo-B', fontSize=11, leading=14, textColor=GOLD, alignment=TA_CENTER)))
    cover.append(Paragraph('For a life well lived', ParagraphStyle('cbt', fontName='Geo-I', fontSize=10, leading=14, textColor=MIST, alignment=TA_CENTER)))
    all_story = cover + [PageBreak()]
    # opening page (intro) uses body template
    from reportlab.platypus.doctemplate import NextPageTemplate
    all_story = [NextPageTemplate('cover')] + cover + [NextPageTemplate('body'), PageBreak()]
    all_story.append(Paragraph('A short book', styles['num']))
    all_story.append(Paragraph('Why this exists', styles['h1']))
    all_story.append(Spacer(1, 3))
    for p in [
        'Daybook is a place for your whole life, organised by the parts that matter to you. But the tools are only the surface. Underneath sits a small set of beliefs about how a life is actually lived well &mdash; and those beliefs shaped every decision in the app.',
        'This little book lays them out: nine short ideas, each with a line from someone who saw it long before us, and a note on how Daybook tries to honour it. Read it in ten minutes. Keep what rings true.',
    ]:
        all_story.append(Paragraph(p, styles['body']))
    all_story.append(PageBreak())
    all_story += story
    # closing
    all_story.append(Spacer(1, 30*mm))
    all_story.append(Paragraph('For a life well lived.', ParagraphStyle('end', fontName='Geo-I', fontSize=14, leading=20, textColor=GOLD, alignment=TA_CENTER)))
    all_story.append(Spacer(1, 4))
    all_story.append(Paragraph('daybook.fyi', ParagraphStyle('endu', fontName='Geo', fontSize=10, leading=14, textColor=MIST, alignment=TA_CENTER)))
    doc.build(all_story)
    print('built daybook-guide.pdf')

build()
