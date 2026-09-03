import type { TemplateButton, TemplateSampleValues } from '@/types';

export interface StarterMessageTemplate {
  slug: string;
  name: string;
  title: string;
  description: string;
  category: 'Marketing' | 'Utility';
  language: string;
  header_format: 'none' | 'text' | 'image' | 'video' | 'document';
  header_content?: string;
  header_sample?: string;
  header_media_url?: string;
  body_text: string;
  sample_values?: TemplateSampleValues;
  footer_text?: string;
  buttons?: TemplateButton[];
  tags: string[];
}

export const STARTER_MESSAGE_TEMPLATES: StarterMessageTemplate[] = [
  {
    slug: 'welcome_greeting',
    name: 'welcome_greeting',
    title: 'Customer Welcome Greeting',
    description: 'Warmly welcome new customers and introduce your brand or support team.',
    category: 'Marketing',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Hello {{1}}, welcome to {{2}}! 👋 We are delighted to assist you. How can our team help you today?',
    sample_values: {
      body: ['John', 'CloudMaSa'],
    },
    footer_text: 'Reply STOP to unsubscribe',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Browse Services' },
      { type: 'QUICK_REPLY', text: 'Talk to Agent' },
    ],
    tags: ['Welcome', 'Onboarding', 'Greeting'],
  },
  {
    slug: 'order_confirmation',
    name: 'order_confirmation',
    title: 'Order Confirmation',
    description: 'Instant notification confirming an order placement with details.',
    category: 'Utility',
    language: 'en_US',
    header_format: 'text',
    header_content: 'Order Confirmed: #{{1}}',
    header_sample: 'ORD-8921',
    body_text: 'Hi {{1}}, thank you for your order! 🎉 We have received your order #{{2}} for {{3}}. We are processing it and will notify you when it ships.',
    sample_values: {
      body: ['Sarah', 'ORD-8921', '$149.00'],
    },
    footer_text: 'Need help? Contact support anytime.',
    buttons: [
      { type: 'URL', text: 'Track Order', url: 'https://example.com/orders/{{1}}', example: 'ORD-8921' },
      { type: 'QUICK_REPLY', text: 'Order Details' },
    ],
    tags: ['E-commerce', 'Orders', 'Utility'],
  },
  {
    slug: 'appointment_reminder',
    name: 'appointment_reminder',
    title: 'Appointment / Meeting Reminder',
    description: 'Remind clients of upcoming appointments or consultations to reduce no-shows.',
    category: 'Utility',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Hi {{1}}, this is a friendly reminder for your appointment with {{2}} on {{3}} at {{4}}. Please let us know if you need to reschedule.',
    sample_values: {
      body: ['Alex', 'Dr. Smith', 'Friday, Sept 5', '10:30 AM'],
    },
    footer_text: 'Tap below to confirm attendance',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Confirm Attendance' },
      { type: 'QUICK_REPLY', text: 'Reschedule' },
    ],
    tags: ['Appointments', 'Reminders', 'Healthcare', 'Consulting'],
  },
  {
    slug: 'shipping_delivery_update',
    name: 'shipping_delivery_update',
    title: 'Out for Delivery Alert',
    description: 'Notify customers when their shipment is on its way for delivery.',
    category: 'Utility',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Great news {{1}}! 🚚 Your package #{{2}} is out for delivery today with {{3}}. Expected arrival by {{4}}.',
    sample_values: {
      body: ['Emily', 'TRK-55421', 'Express Delivery', '4:00 PM'],
    },
    footer_text: 'Please ensure someone is available to receive the package.',
    buttons: [
      { type: 'URL', text: 'Live Tracking', url: 'https://track.example.com/{{1}}', example: 'TRK-55421' },
    ],
    tags: ['Shipping', 'Delivery', 'Logistics'],
  },
  {
    slug: 'exclusive_discount_offer',
    name: 'exclusive_discount_offer',
    title: 'Exclusive Promo & Discount Offer',
    description: 'Drive sales by sharing special promotional codes and seasonal discounts.',
    category: 'Marketing',
    language: 'en_US',
    header_format: 'text',
    header_content: 'Special {{1}}% Discount Just For You!',
    header_sample: '25',
    body_text: 'Hi {{1}}, enjoy an exclusive {{2}}% off on all products at {{3}}! 🛍️ Use promo code {{4}} at checkout. Offer valid until {{5}}.',
    sample_values: {
      body: ['David', '25', 'CloudMaSa Store', 'SPECIAL25', 'this Sunday'],
    },
    footer_text: 'Terms & conditions apply.',
    buttons: [
      { type: 'COPY_CODE', text: 'Copy Promo Code', example: 'SPECIAL25' },
      { type: 'URL', text: 'Shop Now', url: 'https://example.com/shop' },
    ],
    tags: ['Sales', 'Marketing', 'Discounts', 'Promotions'],
  },
  {
    slug: 'lead_qualification_followup',
    name: 'lead_qualification_followup',
    title: 'Lead Follow-up & Demo Invite',
    description: 'Follow up with potential leads to schedule a product demo or discovery call.',
    category: 'Marketing',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Hi {{1}}, thanks for your interest in {{2}}! 🚀 Would you like to schedule a quick 10-minute walkthrough to see how we can help {{3}}?',
    sample_values: {
      body: ['Michael', 'CloudMaSa CRM', 'scale your sales'],
    },
    footer_text: 'CloudMaSa Sales Team',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Schedule Demo' },
      { type: 'QUICK_REPLY', text: 'Send Brochure' },
    ],
    tags: ['Leads', 'Sales', 'B2B', 'Demo'],
  },
  {
    slug: 'customer_feedback_request',
    name: 'customer_feedback_request',
    title: 'Customer Satisfaction & Feedback',
    description: 'Collect valuable feedback and reviews following support or purchases.',
    category: 'Utility',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Hello {{1}}, thank you for choosing {{2}}! ⭐ How was your recent experience with our team? Your feedback helps us serve you better.',
    sample_values: {
      body: ['Jessica', 'CloudMaSa'],
    },
    footer_text: 'Rate your experience below',
    buttons: [
      { type: 'QUICK_REPLY', text: '⭐ Excellent (5/5)' },
      { type: 'QUICK_REPLY', text: '👍 Good (4/5)' },
      { type: 'QUICK_REPLY', text: '💬 Need Improvement' },
    ],
    tags: ['Feedback', 'CSAT', 'Reviews', 'Support'],
  },
  {
    slug: 'payment_invoice_reminder',
    name: 'payment_invoice_reminder',
    title: 'Payment & Invoice Due Reminder',
    description: 'Gentle notification alerting customers to upcoming or overdue invoices.',
    category: 'Utility',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Hello {{1}}, a gentle reminder that invoice #{{2}} for {{3}} is due on {{4}}. Please complete the payment to avoid service interruptions.',
    sample_values: {
      body: ['Robert', 'INV-2024-09', '$450.00', 'Sept 10, 2026'],
    },
    footer_text: 'If payment was already made, please disregard this notice.',
    buttons: [
      { type: 'URL', text: 'Pay Invoice Online', url: 'https://pay.example.com/invoice/{{1}}', example: 'INV-2024-09' },
      { type: 'QUICK_REPLY', text: 'Contact Accounts' },
    ],
    tags: ['Finance', 'Invoices', 'Billing', 'Utility'],
  },
  {
    slug: 'support_ticket_update',
    name: 'support_ticket_update',
    title: 'Support Ticket Status Update',
    description: 'Keep customers informed when their support inquiry is updated or resolved.',
    category: 'Utility',
    language: 'en_US',
    header_format: 'none',
    body_text: 'Hi {{1}}, your support ticket #{{2}} regarding "{{3}}" has been updated to: {{4}}. Let us know if you have further questions.',
    sample_values: {
      body: ['Karen', 'TICK-904', 'Login Assistance', 'Resolved'],
    },
    footer_text: 'CloudMaSa Customer Support Team',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Reopen Ticket' },
      { type: 'QUICK_REPLY', text: 'Confirm Resolved' },
    ],
    tags: ['Support', 'Helpdesk', 'Ticketing'],
  },
  {
    slug: 'event_webinar_invitation',
    name: 'event_webinar_invitation',
    title: 'Event & Webinar Invitation',
    description: 'Invite customers to live webinars, workshops, or product launch events.',
    category: 'Marketing',
    language: 'en_US',
    header_format: 'text',
    header_content: 'You’re Invited: {{1}}',
    header_sample: 'WhatsApp Marketing Masterclass',
    body_text: 'Hello {{1}}! 🎟️ You are invited to join our live session "{{2}}" on {{3}} at {{4}}. Learn proven strategies to 10x your customer engagement.',
    sample_values: {
      body: ['Customer', 'WhatsApp Marketing Masterclass', 'Thursday, Sept 12', '3:00 PM EST'],
    },
    footer_text: 'Limited seats available. Reserve now.',
    buttons: [
      { type: 'URL', text: 'Register Free', url: 'https://example.com/webinar/register' },
      { type: 'QUICK_REPLY', text: 'Remind Me Later' },
    ],
    tags: ['Events', 'Webinars', 'Marketing', 'Workshops'],
  }
];
