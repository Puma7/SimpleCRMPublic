declare module 'mailparser' {
  import type { Readable } from 'stream';

  export interface AddressObject {
    value: { name?: string; address?: string }[];
  }

  export interface ParsedMail {
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    subject?: string;
    from?: AddressObject;
    to?: AddressObject;
    cc?: AddressObject;
    date?: Date;
    text?: string;
    html?: string | false;
  }

  export function simpleParser(source: Buffer | string | Readable): Promise<ParsedMail>;
}
