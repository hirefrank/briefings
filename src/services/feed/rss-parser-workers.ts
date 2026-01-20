/**
 * Cloudflare Workers-compatible RSS parser using fast-xml-parser
 */

import { XMLParser } from 'fast-xml-parser';

export interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  creator?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  isoDate?: string;
}

export interface RSSFeed {
  title?: string;
  description?: string;
  link?: string;
  items: RSSItem[];
}

// Type definitions for parsed XML structures
interface RSSChannel {
  title?: unknown;
  description?: unknown;
  link?: unknown;
  item?: RSSItemData[];
}

interface RSSItemData {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  guid?: unknown;
  'dc:creator'?: unknown;
  author?: unknown;
  creator?: unknown;
  'content:encoded'?: unknown;
  content?: unknown;
  description?: unknown;
  summary?: unknown;
}

interface AtomFeed {
  title?: unknown;
  subtitle?: unknown;
  link?: AtomLink | AtomLink[] | string;
  entry?: AtomEntry[];
}

interface AtomEntry {
  title?: unknown;
  link?: AtomLink | AtomLink[] | string;
  published?: unknown;
  updated?: unknown;
  id?: unknown;
  author?: AtomAuthor | string;
  content?: unknown;
  summary?: unknown;
}

interface AtomLink {
  '@_rel'?: string;
  '@_href'?: string;
}

interface AtomAuthor {
  name?: unknown;
  email?: unknown;
}

interface ParsedXML {
  rss?: {
    channel?: RSSChannel;
  };
  feed?: AtomFeed;
}

export class WorkersRSSParser {
  private readonly timeout: number;
  private readonly headers: Record<string, string>;
  private readonly xmlParser: XMLParser;

  constructor(options?: { timeout?: number; headers?: Record<string, string> }) {
    this.timeout = options?.timeout || 30000;
    this.headers = {
      'User-Agent': 'Briefings/1.0 (+https://github.com/yourusername/briefings)',
      ...options?.headers,
    };

    // Configure fast-xml-parser
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      trimValues: true,
      parseTagValue: true,
      allowBooleanAttributes: true,
      removeNSPrefix: false, // Keep namespaces to handle dc:creator, content:encoded etc
      alwaysCreateTextNode: false,
      isArray: (name) => {
        // Always treat 'item' and 'entry' as arrays
        return name === 'item' || name === 'entry';
      },
    });
  }

  async parseURL(url: string): Promise<RSSFeed> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        headers: this.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const text = await response.text();
      return this.parseXML(text);
    } catch (error) {
      console.error(`[WorkersRSSParser] Error fetching feed:`, error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseXML(xmlText: string): RSSFeed {
    try {
      const parsed = this.xmlParser.parse(xmlText) as ParsedXML;

      // Check if it's RSS or Atom
      if (parsed.rss?.channel) {
        return this.parseRSS(parsed.rss.channel);
      } else if (parsed.feed) {
        return this.parseAtom(parsed.feed);
      } else {
        throw new Error('Unknown feed format - neither RSS nor Atom');
      }
    } catch (error) {
      console.error(`[WorkersRSSParser] Error parsing XML:`, error);
      throw error;
    }
  }

  private parseRSS(channel: RSSChannel): RSSFeed {
    const feed: RSSFeed = {
      title: this.getTextValue(channel.title),
      description: this.getTextValue(channel.description),
      link: this.getTextValue(channel.link),
      items: [],
    };

    // Handle items
    const items = channel.item || [];
    feed.items = items.map((item: RSSItemData) => this.parseRSSItem(item));

    return feed;
  }

  private parseRSSItem(item: RSSItemData): RSSItem {
    const pubDateStr = this.getTextValue(item.pubDate);
    const parsedItem: RSSItem = {
      title: this.getTextValue(item.title),
      link: this.getTextValue(item.link),
      pubDate: pubDateStr,
      guid: this.getTextValue(item.guid),
      creator:
        this.getTextValue(item['dc:creator']) ||
        this.getTextValue(item.author) ||
        this.getTextValue(item.creator),
      content: this.getTextValue(item['content:encoded']) || this.getTextValue(item.content),
      contentSnippet: this.stripHtml(
        this.getTextValue(item.description) || this.getTextValue(item.summary)
      ),
    };

    // Convert pubDate to ISO string if possible
    if (pubDateStr) {
      try {
        const date = new Date(pubDateStr);
        if (!isNaN(date.getTime())) {
          parsedItem.isoDate = date.toISOString();
        }
      } catch {
        // Keep original pubDate if parsing fails
      }
    }

    return parsedItem;
  }

  private parseAtom(feed: AtomFeed): RSSFeed {
    const parsedFeed: RSSFeed = {
      title: this.getTextValue(feed.title),
      description: this.getTextValue(feed.subtitle),
      link: this.getAtomLink(feed.link),
      items: [],
    };

    // Handle entries
    const entries = feed.entry || [];
    parsedFeed.items = entries.map((entry: AtomEntry) => this.parseAtomEntry(entry));

    return parsedFeed;
  }

  private parseAtomEntry(entry: AtomEntry): RSSItem {
    const publishedStr = this.getTextValue(entry.published) || this.getTextValue(entry.updated);

    const parsedItem: RSSItem = {
      title: this.getTextValue(entry.title),
      link: this.getAtomLink(entry.link),
      pubDate: publishedStr,
      guid: this.getTextValue(entry.id),
      creator: this.getAuthorName(entry.author),
      content: this.getTextValue(entry.content),
      contentSnippet: this.stripHtml(this.getTextValue(entry.summary)),
    };

    // Atom dates are already ISO format
    if (publishedStr) {
      parsedItem.isoDate = publishedStr;
    }

    return parsedItem;
  }

  private getTextValue(value: unknown): string | undefined {
    if (!value) return undefined;

    // If it's a string, return it
    if (typeof value === 'string') return value;

    // If it's an object with #text property (from XML parser)
    if (typeof value === 'object' && value !== null && '#text' in value) {
      return this.getTextValue((value as { '#text': unknown })['#text']);
    }

    // If it's an object with a single text node
    if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
      return undefined;
    }

    // Try to convert to string
    return String(value);
  }

  private getAuthorName(author: AtomAuthor | string | undefined): string | undefined {
    if (!author) return undefined;

    if (typeof author === 'string') return author;

    // Handle object format { name: "...", email: "..." }
    if (typeof author === 'object' && author.name) {
      return this.getTextValue(author.name);
    }

    return undefined;
  }

  private getAtomLink(link: AtomLink | AtomLink[] | string | undefined): string | undefined {
    if (!link) return undefined;

    // If it's a string, return it
    if (typeof link === 'string') return link;

    // If it's an array of links
    if (Array.isArray(link)) {
      // Look for alternate link first
      const alternate = link.find((l) => l['@_rel'] === 'alternate');
      if (alternate?.['@_href']) return alternate['@_href'];

      // Return first link with href
      const firstWithHref = link.find((l) => l['@_href']);
      if (firstWithHref?.['@_href']) return firstWithHref['@_href'];
    }

    // If it's a single link object
    if (link['@_href']) return link['@_href'];

    return undefined;
  }

  private stripHtml(text?: string): string | undefined {
    if (!text) return undefined;

    // Remove HTML tags
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
      .replace(/&amp;/g, '&') // Decode ampersands
      .replace(/&lt;/g, '<') // Decode less than
      .replace(/&gt;/g, '>') // Decode greater than
      .replace(/&quot;/g, '"') // Decode quotes
      .replace(/&#39;/g, "'") // Decode apostrophes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }
}
