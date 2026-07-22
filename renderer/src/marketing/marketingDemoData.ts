export const demoScenes = ['cover', 'inbox', 'today', 'calendar', 'cleanup'] as const;
export type DemoScene = typeof demoScenes[number];

export interface DemoThread {
  sender: string;
  email: string;
  subject: string;
  preview: string;
  time: string;
  unread?: boolean;
  label?: string;
  accent: string;
}

export const demoThreads: DemoThread[] = [
  {
    sender: 'Maya Chen',
    email: 'maya@atlas-research.example',
    subject: 'Launch brief — final notes',
    preview: 'The direction is strong. Could you confirm the rollout window and owner?',
    time: '09:42',
    unread: true,
    label: 'Needs reply',
    accent: '#668FEA',
  },
  {
    sender: 'Theo Grant',
    email: 'theo@northstar-studio.example',
    subject: 'Q3 budget sign-off',
    preview: 'Finance approved the revised plan. One final question about the research line.',
    time: '08:17',
    unread: true,
    label: 'Important',
    accent: '#9173ED',
  },
  {
    sender: 'Lina Ortiz',
    email: 'lina@field-notes.example',
    subject: 'Design critique moved to 14:30',
    preview: 'I moved the critique by thirty minutes and kept the same Meet room.',
    time: 'Yesterday',
    label: 'Calendar',
    accent: '#33A16E',
  },
  {
    sender: 'Pine Labs',
    email: 'updates@pine-labs.example',
    subject: 'Your weekly workspace digest',
    preview: 'Seven decisions, three open questions, and two documents changed this week.',
    time: 'Yesterday',
    accent: '#EB8C3D',
  },
  {
    sender: 'Aperture Supply',
    email: 'orders@aperture-supply.example',
    subject: 'Order #NS-2048 has shipped',
    preview: 'Your studio supplies are on the way. Estimated delivery: Friday.',
    time: 'Tue',
    label: 'Purchases',
    accent: '#087D98',
  },
  {
    sender: 'Sofia Bell',
    email: 'sofia@common-ground.example',
    subject: 'Notes from the partner call',
    preview: 'Sharing the decisions and the two follow-ups we committed to.',
    time: 'Mon',
    accent: '#DF4A4A',
  },
  {
    sender: 'Atlas Research',
    email: 'briefs@atlas-research.example',
    subject: 'Research synthesis is ready',
    preview: 'The final synthesis includes the launch risks and recommended next steps.',
    time: 'Mon',
    label: 'updates',
    accent: '#668FEA',
  },
  {
    sender: 'Common Ground',
    email: 'hello@common-ground.example',
    subject: 'You have one new invitation',
    preview: 'See who reached out and review the collaboration details.',
    time: 'Mon',
    label: 'social',
    accent: '#9173ED',
  },
  {
    sender: 'Northstar Studio',
    email: 'updates@northstar-studio.example',
    subject: 'Your workspace changed this week',
    preview: 'Three decisions were resolved and two documents are ready for review.',
    time: 'Sun',
    label: 'updates',
    accent: '#087D98',
  },
  {
    sender: 'GitHub',
    email: 'notifications@github.example',
    subject: '[dumka-mail] Build completed successfully',
    preview: 'All checks passed for the latest change on the main branch.',
    time: 'Sun',
    label: 'GitHub',
    accent: '#536178',
  },
  {
    sender: 'Aperture Supply',
    email: 'receipts@aperture-supply.example',
    subject: 'Receipt for order #NS-2048',
    preview: 'Your receipt and delivery summary are attached.',
    time: 'Sat',
    label: 'purchases',
    accent: '#EB8C3D',
  },
  {
    sender: 'Field Notes Weekly',
    email: 'weekly@field-notes.example',
    subject: 'Five product lessons from this week',
    preview: 'A compact digest of launches, experiments, and useful decisions.',
    time: 'Fri',
    label: 'automation',
    accent: '#33A16E',
  },
];

export const demoEvents = [
  { day: 1, start: 9, duration: 1.5, title: 'Weekly planning', detail: 'Studio · 6 people', color: '#668FEA' },
  { day: 1, start: 13, duration: 1, title: 'Research review', detail: 'Atlas · Meet', color: '#9173ED' },
  { day: 2, start: 10, duration: 1, title: 'Writing block', detail: 'Focus time', color: '#33A16E' },
  { day: 2, start: 14.5, duration: 1, title: 'Design critique', detail: 'Northstar · Meet', color: '#EB8C3D' },
  { day: 3, start: 11, duration: 1, title: 'Partner sync', detail: 'Common Ground', color: '#087D98' },
  { day: 4, start: 9.5, duration: 2, title: 'Launch workshop', detail: 'Project room', color: '#668FEA' },
  { day: 4, start: 15, duration: 1, title: 'Weekly wrap', detail: 'Studio · 4 people', color: '#33A16E' },
];

export const demoSenders = [
  { sender: 'Product Brief Daily', email: 'digest@product-brief.example', messages: 38, unread: 31, risk: 'High volume', action: 'Unsubscribe + archive' },
  { sender: 'Aperture Offers', email: 'offers@aperture-supply.example', messages: 24, unread: 19, risk: 'Promotional', action: 'Archive all' },
  { sender: 'Meetup Roundup', email: 'roundup@local-meetup.example', messages: 17, unread: 15, risk: 'Low engagement', action: 'Unsubscribe + archive' },
  { sender: 'Northstar Receipts', email: 'receipts@northstar-studio.example', messages: 12, unread: 0, risk: 'Keep', action: 'Exclude sender' },
];
