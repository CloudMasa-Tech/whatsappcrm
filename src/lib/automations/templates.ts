import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'new_contact_onboarding'
  | 'conversation_assigned_notice'
  | 'vip_tag_routing'
  | 'daily_scheduled_nudge'
  | 'interactive_menu_handler'
  | 'email_opened_whatsapp_nudge'
  | 'email_clicked_hot_lead'
  | 'email_reply_lead_conversion'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  category: 'onboarding' | 'sales' | 'support' | 'retention' | 'email_omnichannel'
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  // 1. Format: first_inbound_message
  welcome_message: {
    slug: 'welcome_message',
    name: 'First Inbound Greeting',
    description: 'Auto-reply to brand new contacts with a warm welcome and route to the team.',
    category: 'onboarding',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Welcome to RegiBIZ & CloudMaSa. Thanks for reaching out! We'll connect you with a specialist shortly.",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },

  // 2. Format: new_message_received (with off-hours condition)
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office Auto-Responder',
    description: 'Auto-reply when customers message outside business hours (6pm–9am).',
    category: 'support',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: "Thanks for your message! Our team is currently offline (working hours 9am–6pm). We will reply first thing tomorrow morning!",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },

  // 3. Format: keyword_match
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Keyword Lead Qualifier & Pricing',
    description: 'Detect pricing, quote, and cost inquiries and send instant interactive options.',
    category: 'sales',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'cost', 'plans', 'demo'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Great! Happy to share our pricing and registration details. Quick question: roughly how many seats or services are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 5, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },

  // 4. Format: new_message_received (inactivity follow-up)
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: '24-Hour Follow-Up Reminder',
    description: 'Send a gentle automated nudge if a conversation has been idle for 24 hours.',
    category: 'retention',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: "Just circling back — did you have any questions regarding your company setup or GST? Happy to jump on a quick call!",
        },
      },
    ],
  },

  // 5. Format: new_contact_created
  new_contact_onboarding: {
    slug: 'new_contact_onboarding',
    name: 'New Contact Onboarding Sequence',
    description: 'Triggers when a new contact is added/imported; sends a welcome note and 2-day check-in.',
    category: 'onboarding',
    trigger_type: 'new_contact_created',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Welcome to CloudMaSa! We've created your customer account. Feel free to message us here on WhatsApp anytime.",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 2, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! Following up to see if you had any questions getting started with your account. We're here to help!",
        },
      },
    ],
  },

  // 6. Format: conversation_assigned
  conversation_assigned_notice: {
    slug: 'conversation_assigned_notice',
    name: 'Agent Assignment Notification',
    description: 'Notify the customer immediately when a support agent takes ownership of their chat.',
    category: 'support',
    trigger_type: 'conversation_assigned',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hello! A dedicated support specialist has been assigned to your conversation and is reviewing your request now.",
        },
      },
    ],
  },

  // 7. Format: tag_added
  vip_tag_routing: {
    slug: 'vip_tag_routing',
    name: 'VIP Tag Fast-Track Routing',
    description: 'When a contact is tagged as VIP or Hot Lead, prioritize and route to senior reps.',
    category: 'sales',
    trigger_type: 'tag_added',
    trigger_config: {
      tag_id: 'vip',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Thank you for reaching out! As a priority partner, your request has been fast-tracked to our executive team.",
        },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },

  // 8. Format: time_based
  daily_scheduled_nudge: {
    slug: 'daily_scheduled_nudge',
    name: 'Scheduled Weekly Check-In',
    description: 'Trigger on a recurring cron schedule (e.g. Monday morning) to check in with active clients.',
    category: 'retention',
    trigger_type: 'time_based',
    trigger_config: {
      schedule: '0 10 * * 1',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Good morning! Wishing you a productive week ahead. Let our team know if there is anything we can support you with today.",
        },
      },
    ],
  },

  // 9. Format: interactive_reply
  interactive_menu_handler: {
    slug: 'interactive_menu_handler',
    name: 'Button & List Menu Reply Handler',
    description: 'Handle customer button taps or interactive list selections with automated branching.',
    category: 'support',
    trigger_type: 'interactive_reply',
    trigger_config: {
      reply_ids: ['btn_services', 'btn_support', 'btn_pricing', 'btn_talk_human'],
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Thanks for selecting an option! We've received your choice and our team is pulling up your details.",
        },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },

  // 10. Format: email_opened
  email_opened_whatsapp_nudge: {
    slug: 'email_opened_whatsapp_nudge',
    name: 'Email Open → WhatsApp Outreach',
    description: 'When a prospect opens your campaign email, wait 5 minutes and follow up on WhatsApp.',
    category: 'email_omnichannel',
    trigger_type: 'email_opened',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 5, unit: 'minutes' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! Noticed you were reviewing our email regarding GST & company registration. Happy to answer any questions right here on WhatsApp!",
        },
      },
    ],
  },

  // 11. Format: email_clicked
  email_clicked_hot_lead: {
    slug: 'email_clicked_hot_lead',
    name: 'Email Link Click → High Intent Alert',
    description: 'When a prospect clicks a tracked proposal/pricing link in an email, fast-track to sales.',
    category: 'email_omnichannel',
    trigger_type: 'email_clicked',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! Saw you clicked through our service proposal. Would you be open to a quick 5-minute call or walkthrough today?",
        },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },

  // 12. Format: email_replied
  email_reply_lead_conversion: {
    slug: 'email_reply_lead_conversion',
    name: 'Email Reply → Priority Team Routing',
    description: 'When a customer replies to an email campaign, assign to an agent and send immediate confirmation.',
    category: 'email_omnichannel',
    trigger_type: 'email_replied',
    trigger_config: {},
    steps: [
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text: "Hello! We received your email reply and logged it in your customer thread. An account manager is reviewing it now!",
        },
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}
