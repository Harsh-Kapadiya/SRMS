/**
 * Reference data loaded by `pnpm db:bootstrap` (safe to run in production and
 * idempotent). Entitlements follow the National Food Security Act, 2013:
 *   - Priority Household (PHH): 5 kg food-grain per member per month
 *   - Antyodaya Anna Yojana (AAY): 35 kg food-grain per family per month
 * The rice/wheat split and sugar are state-configurable from the admin app.
 */

export const STATE_NAME = 'Bihar';

export const DISTRICTS: ReadonlyArray<{ code: string; name: string; nameHi: string }> = [
  { code: 'ARR', name: 'Araria', nameHi: 'अररिया' },
  { code: 'ARW', name: 'Arwal', nameHi: 'अरवल' },
  { code: 'AUR', name: 'Aurangabad', nameHi: 'औरंगाबाद' },
  { code: 'BNK', name: 'Banka', nameHi: 'बांका' },
  { code: 'BEG', name: 'Begusarai', nameHi: 'बेगूसराय' },
  { code: 'BGP', name: 'Bhagalpur', nameHi: 'भागलपुर' },
  { code: 'BHO', name: 'Bhojpur', nameHi: 'भोजपुर' },
  { code: 'BUX', name: 'Buxar', nameHi: 'बक्सर' },
  { code: 'DBG', name: 'Darbhanga', nameHi: 'दरभंगा' },
  { code: 'ECH', name: 'East Champaran', nameHi: 'पूर्वी चंपारण' },
  { code: 'GAY', name: 'Gaya', nameHi: 'गया' },
  { code: 'GOP', name: 'Gopalganj', nameHi: 'गोपालगंज' },
  { code: 'JAM', name: 'Jamui', nameHi: 'जमुई' },
  { code: 'JEH', name: 'Jehanabad', nameHi: 'जहानाबाद' },
  { code: 'KAI', name: 'Kaimur', nameHi: 'कैमूर' },
  { code: 'KAT', name: 'Katihar', nameHi: 'कटिहार' },
  { code: 'KHA', name: 'Khagaria', nameHi: 'खगड़िया' },
  { code: 'KIS', name: 'Kishanganj', nameHi: 'किशनगंज' },
  { code: 'LAK', name: 'Lakhisarai', nameHi: 'लखीसराय' },
  { code: 'MDP', name: 'Madhepura', nameHi: 'मधेपुरा' },
  { code: 'MDB', name: 'Madhubani', nameHi: 'मधुबनी' },
  { code: 'MUN', name: 'Munger', nameHi: 'मुंगेर' },
  { code: 'MUZ', name: 'Muzaffarpur', nameHi: 'मुजफ्फरपुर' },
  { code: 'NAL', name: 'Nalanda', nameHi: 'नालंदा' },
  { code: 'NAW', name: 'Nawada', nameHi: 'नवादा' },
  { code: 'PAT', name: 'Patna', nameHi: 'पटना' },
  { code: 'PUR', name: 'Purnia', nameHi: 'पूर्णिया' },
  { code: 'ROH', name: 'Rohtas', nameHi: 'रोहतास' },
  { code: 'SAH', name: 'Saharsa', nameHi: 'सहरसा' },
  { code: 'SAM', name: 'Samastipur', nameHi: 'समस्तीपुर' },
  { code: 'SAR', name: 'Saran', nameHi: 'सारण' },
  { code: 'SHK', name: 'Sheikhpura', nameHi: 'शेखपुरा' },
  { code: 'SHE', name: 'Sheohar', nameHi: 'शिवहर' },
  { code: 'SIT', name: 'Sitamarhi', nameHi: 'सीतामढ़ी' },
  { code: 'SIW', name: 'Siwan', nameHi: 'सीवान' },
  { code: 'SUP', name: 'Supaul', nameHi: 'सुपौल' },
  { code: 'VAI', name: 'Vaishali', nameHi: 'वैशाली' },
  { code: 'WCH', name: 'West Champaran', nameHi: 'पश्चिमी चंपारण' },
];

export const COMMODITIES = [
  { code: 'RICE', name: 'Rice', nameHi: 'चावल', unit: 'KG', pricePerUnit: 0, sortOrder: 1 },
  { code: 'WHEAT', name: 'Wheat', nameHi: 'गेहूँ', unit: 'KG', pricePerUnit: 0, sortOrder: 2 },
  { code: 'SUGAR', name: 'Sugar', nameHi: 'चीनी', unit: 'KG', pricePerUnit: 13.5, sortOrder: 3 },
] as const;

export const ENTITLEMENTS: ReadonlyArray<{
  commodity: (typeof COMMODITIES)[number]['code'];
  cardType: 'AAY' | 'PHH';
  qtyPerMember: number;
  qtyPerFamily: number;
}> = [
  { commodity: 'RICE', cardType: 'PHH', qtyPerMember: 3, qtyPerFamily: 0 },
  { commodity: 'WHEAT', cardType: 'PHH', qtyPerMember: 2, qtyPerFamily: 0 },
  { commodity: 'RICE', cardType: 'AAY', qtyPerMember: 0, qtyPerFamily: 21 },
  { commodity: 'WHEAT', cardType: 'AAY', qtyPerMember: 0, qtyPerFamily: 14 },
  { commodity: 'SUGAR', cardType: 'AAY', qtyPerMember: 0, qtyPerFamily: 1 },
];

export const DEFAULT_SETTINGS: ReadonlyArray<{ key: string; value: unknown; description: string }> = [
  { key: 'low_stock_pct', value: 20, description: 'Low-stock alert when available stock falls below this % of the monthly quota (SRS R5)' },
  { key: 'max_shops_per_dealer', value: 3, description: "Maximum active shops per dealer, all in the dealer's district (SRS R11)" },
  { key: 'otp_ttl_seconds', value: 300, description: 'Lifetime of one-time passwords' },
  { key: 'require_pos_otp', value: true, description: 'Require beneficiary OTP at the shop before ration is issued (SRS R2)' },
  { key: 'offline_max_hours', value: 72, description: 'Offline dealer transactions older than this are flagged for review on sync (NFR-2)' },
  { key: 'sms_enabled', value: true, description: 'Send SMS notifications through the configured gateway (FR-7)' },
  { key: 'state_name', value: STATE_NAME, description: 'State this deployment serves' },
];
