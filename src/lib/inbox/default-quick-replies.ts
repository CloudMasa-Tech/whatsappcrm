export interface QuickReplySnippet {
  shortcut: string;
  title: string;
  content: string;
}

export const DEFAULT_QUICK_REPLIES: QuickReplySnippet[] = [
  {
    shortcut: "/welcome",
    title: "Greeting & Welcome",
    content: "Hello! Thank you for reaching out to us. How can our team assist you today?",
  },
  {
    shortcut: "/pricing",
    title: "Pricing & Plans",
    content: "Thank you for inquiring about our pricing! Our plans start with flexible tiers tailored for your business needs. Would you like us to share our detailed product brochure and current offers?",
  },
  {
    shortcut: "/hours",
    title: "Business Hours",
    content: "Our business hours are Monday through Saturday, from 9:00 AM to 6:30 PM. We are always happy to assist you during these hours!",
  },
  {
    shortcut: "/bank",
    title: "Bank & Payment Details",
    content: "Here are our official company bank details for payment processing:\nAccount Name: CloudMaSa Tech Pvt Ltd\nBank: HDFC Bank\nIFSC Code: HDFC0001234\nPlease share the transaction receipt or screenshot once completed.",
  },
  {
    shortcut: "/demo",
    title: "Schedule a Live Demo",
    content: "We would be delighted to schedule a personalized live walkthrough for your team! What time slot works best for you this week?",
  },
  {
    shortcut: "/followup",
    title: "Gentle Follow-up",
    content: "Hi there! Just following up on our previous conversation to check if you had any further questions or if you're ready to proceed.",
  },
];
