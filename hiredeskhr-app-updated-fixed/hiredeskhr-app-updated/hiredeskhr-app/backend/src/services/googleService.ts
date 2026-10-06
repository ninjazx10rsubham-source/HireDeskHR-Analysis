import { v4 as uuidv4 } from 'uuid';

export interface CalendarEventParams {
  id?: string;
  title: string;
  description: string;
  startTime: string; // ISO String
  durationMinutes: number;
  location?: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  timezone?: string;
}

export class GoogleService {
  /**
   * Generates a deterministic or random Google Meet video link
   */
  generateGoogleMeetLink(prefix = 'ats'): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const randPart = (len: number) =>
      Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `https://meet.google.com/${randPart(3)}-${randPart(4)}-${randPart(3)}`;
  }

  /**
   * Formats date to iCalendar UTC format (YYYYMMDDTHHMMSSZ)
   */
  private formatIcsDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  /**
   * Generates standard RFC 5545 iCalendar (.ics) format string
   */
  generateIcsContent(event: CalendarEventParams): string {
    const start = new Date(event.startTime);
    const end = new Date(start.getTime() + event.durationMinutes * 60000);
    const now = new Date();
    const uid = event.id || `event-${uuidv4()}@hiredeskhr.com`;

    const startIcs = this.formatIcsDate(start);
    const endIcs = this.formatIcsDate(end);
    const createdIcs = this.formatIcsDate(now);

    const cleanDesc = (event.description || '').replace(/\r?\n/g, '\\n');
    const location = event.location || 'Google Meet (link provided in event)';

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//HiredeskHR//Interview Calendar 1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${createdIcs}`,
      `DTSTART:${startIcs}`,
      `DTEND:${endIcs}`,
      `SUMMARY:${event.title}`,
      `DESCRIPTION:${cleanDesc}`,
      `LOCATION:${location}`,
      `ORGANIZER;CN="${event.organizerName}":mailto:${event.organizerEmail}`,
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="${event.attendeeName}":mailto:${event.attendeeEmail}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'SEQUENCE:0',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Interview Reminder: ' + event.title,
      'TRIGGER:-PT15M',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
  }

  /**
   * Generates a Google Calendar Web Add-Event URL
   */
  generateGoogleCalendarWebUrl(event: CalendarEventParams): string {
    const start = new Date(event.startTime);
    const end = new Date(start.getTime() + event.durationMinutes * 60000);

    const startStr = this.formatIcsDate(start);
    const endStr = this.formatIcsDate(end);

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${startStr}/${endStr}`,
      details: event.description || '',
      location: event.location || '',
      add: event.attendeeEmail
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }
}

export const googleService = new GoogleService();
