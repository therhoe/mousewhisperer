// Datacenter IP detection for bot filtering
// Contains CIDR ranges for major cloud providers

// Common datacenter IP ranges (simplified for performance)
// These are well-known cloud provider ranges
const DATACENTER_RANGES: Array<{ start: number; end: number; provider: string }> = [];

// Convert IP to number for fast comparison
function ipToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return null;
    result = result * 256 + num;
  }
  return result;
}

// Parse CIDR notation
function parseCIDR(cidr: string): { start: number; end: number } | null {
  const [ip, maskStr] = cidr.split("/");
  if (!ip || !maskStr) return null;

  const ipNum = ipToNumber(ip);
  if (ipNum === null) return null;

  const mask = parseInt(maskStr, 10);
  if (isNaN(mask) || mask < 0 || mask > 32) return null;

  const hostBits = 32 - mask;
  const start = ipNum & (~0 << hostBits);
  const end = start + (1 << hostBits) - 1;

  return { start, end };
}

// Initialize datacenter ranges
function initRanges() {
  // AWS ranges (major ones)
  const awsRanges = [
    "3.0.0.0/8",
    "13.32.0.0/12",
    "18.64.0.0/10",
    "35.80.0.0/12",
    "44.192.0.0/10",
    "52.0.0.0/8",
    "54.64.0.0/10",
    "99.77.0.0/16",
    "100.20.0.0/14",
    "108.128.0.0/11",
    "176.32.96.0/19",
  ];

  // Google Cloud ranges
  const gcpRanges = [
    "34.64.0.0/10",
    "35.184.0.0/13",
    "35.192.0.0/12",
    "35.208.0.0/12",
    "35.224.0.0/12",
    "35.240.0.0/13",
    "104.154.0.0/15",
    "104.196.0.0/14",
    "107.167.160.0/19",
    "107.178.192.0/18",
    "108.59.80.0/20",
    "130.211.0.0/16",
    "146.148.0.0/16",
    "162.216.148.0/22",
    "162.222.176.0/20",
    "173.255.112.0/20",
    "199.192.112.0/20",
    "199.223.232.0/21",
  ];

  // Azure ranges (major ones)
  const azureRanges = [
    "13.64.0.0/10",
    "20.0.0.0/8",
    "23.96.0.0/13",
    "40.64.0.0/10",
    "51.4.0.0/14",
    "51.8.0.0/14",
    "51.104.0.0/13",
    "51.124.0.0/14",
    "52.96.0.0/12",
    "52.112.0.0/12",
    "52.160.0.0/11",
    "65.52.0.0/14",
    "70.37.0.0/17",
    "70.37.128.0/17",
    "104.40.0.0/13",
    "168.61.0.0/16",
    "168.62.0.0/15",
  ];

  // DigitalOcean ranges
  const digitalOceanRanges = [
    "64.225.0.0/16",
    "67.205.128.0/17",
    "68.183.0.0/16",
    "104.131.0.0/16",
    "104.236.0.0/16",
    "137.184.0.0/14",
    "138.68.0.0/15",
    "138.197.0.0/16",
    "139.59.0.0/16",
    "142.93.0.0/16",
    "143.110.0.0/16",
    "143.198.0.0/16",
    "144.126.192.0/18",
    "157.230.0.0/15",
    "159.65.0.0/16",
    "159.89.0.0/16",
    "159.203.0.0/16",
    "161.35.0.0/16",
    "162.243.0.0/16",
    "163.47.8.0/21",
    "165.22.0.0/15",
    "165.227.0.0/16",
    "167.99.0.0/16",
    "167.172.0.0/14",
    "174.138.0.0/16",
    "178.128.0.0/14",
    "188.166.0.0/15",
    "192.81.208.0/20",
    "192.241.128.0/17",
    "198.199.64.0/18",
    "206.189.0.0/16",
    "207.154.192.0/18",
  ];

  // Linode ranges
  const linodeRanges = [
    "45.33.0.0/16",
    "45.56.64.0/18",
    "45.79.0.0/16",
    "50.116.0.0/18",
    "66.175.208.0/20",
    "66.228.32.0/19",
    "69.164.192.0/18",
    "72.14.176.0/20",
    "74.207.224.0/19",
    "96.126.96.0/19",
    "97.107.128.0/17",
    "139.162.0.0/16",
    "170.187.128.0/17",
    "172.104.0.0/15",
    "173.255.192.0/18",
    "178.79.128.0/17",
    "192.155.80.0/20",
    "198.58.96.0/19",
    "212.71.232.0/21",
  ];

  // Vultr ranges
  const vultrRanges = [
    "45.32.0.0/15",
    "45.63.0.0/16",
    "45.76.0.0/15",
    "64.156.0.0/14",
    "66.42.32.0/19",
    "78.141.192.0/18",
    "95.179.128.0/17",
    "104.156.224.0/19",
    "108.61.64.0/18",
    "136.244.64.0/18",
    "140.82.0.0/17",
    "144.202.0.0/16",
    "149.28.0.0/16",
    "155.138.128.0/17",
    "185.231.80.0/22",
    "192.248.144.0/20",
    "207.148.64.0/18",
    "208.167.224.0/19",
    "216.128.128.0/17",
    "217.163.0.0/17",
  ];

  // OVH ranges (major ones)
  const ovhRanges = [
    "5.135.0.0/16",
    "5.196.0.0/14",
    "37.59.0.0/16",
    "37.187.0.0/16",
    "46.105.0.0/16",
    "51.38.0.0/15",
    "51.68.0.0/14",
    "51.75.0.0/16",
    "51.77.0.0/16",
    "51.79.0.0/16",
    "51.89.0.0/16",
    "51.91.0.0/16",
    "51.210.0.0/15",
    "54.36.0.0/14",
    "54.38.0.0/15",
    "79.137.0.0/17",
    "87.98.128.0/17",
    "91.121.0.0/16",
    "92.222.0.0/15",
    "135.125.0.0/16",
    "137.74.0.0/16",
    "139.99.0.0/16",
    "142.44.128.0/17",
    "145.239.0.0/16",
    "147.135.0.0/16",
    "149.56.0.0/16",
    "151.80.0.0/14",
    "158.69.0.0/16",
    "167.114.0.0/16",
    "176.31.0.0/16",
    "178.32.0.0/15",
    "185.228.16.0/22",
    "188.165.0.0/16",
    "192.95.0.0/16",
    "193.70.0.0/15",
    "198.27.64.0/18",
    "198.50.128.0/17",
    "198.100.144.0/20",
    "213.32.0.0/16",
    "213.186.32.0/19",
    "213.251.128.0/17",
  ];

  // Hetzner ranges
  const hetznerRanges = [
    "5.9.0.0/16",
    "23.88.0.0/15",
    "49.12.0.0/14",
    "65.108.0.0/15",
    "65.21.0.0/16",
    "78.46.0.0/15",
    "85.10.192.0/18",
    "88.99.0.0/16",
    "88.198.0.0/16",
    "94.130.0.0/16",
    "95.216.0.0/15",
    "116.202.0.0/15",
    "116.203.0.0/16",
    "128.140.0.0/15",
    "135.181.0.0/16",
    "136.243.0.0/16",
    "138.201.0.0/16",
    "142.132.128.0/17",
    "144.76.0.0/16",
    "148.251.0.0/16",
    "157.90.0.0/16",
    "159.69.0.0/16",
    "167.233.0.0/16",
    "168.119.0.0/16",
    "176.9.0.0/16",
    "178.63.0.0/16",
    "188.40.0.0/16",
    "195.201.0.0/16",
    "213.133.96.0/19",
    "213.239.192.0/18",
  ];

  const allRanges = [
    ...awsRanges.map((r) => ({ cidr: r, provider: "AWS" })),
    ...gcpRanges.map((r) => ({ cidr: r, provider: "GCP" })),
    ...azureRanges.map((r) => ({ cidr: r, provider: "Azure" })),
    ...digitalOceanRanges.map((r) => ({ cidr: r, provider: "DigitalOcean" })),
    ...linodeRanges.map((r) => ({ cidr: r, provider: "Linode" })),
    ...vultrRanges.map((r) => ({ cidr: r, provider: "Vultr" })),
    ...ovhRanges.map((r) => ({ cidr: r, provider: "OVH" })),
    ...hetznerRanges.map((r) => ({ cidr: r, provider: "Hetzner" })),
  ];

  for (const { cidr, provider } of allRanges) {
    const range = parseCIDR(cidr);
    if (range) {
      DATACENTER_RANGES.push({ ...range, provider });
    }
  }

  // Sort by start IP for potential binary search optimization later
  DATACENTER_RANGES.sort((a, b) => a.start - b.start);
}

// Initialize ranges on module load
initRanges();

export interface DatacenterCheckResult {
  isDatacenter: boolean;
  provider: string | null;
}

export function isDatacenterIP(ip: string): DatacenterCheckResult {
  const ipNum = ipToNumber(ip);

  if (ipNum === null) {
    return { isDatacenter: false, provider: null };
  }

  // Linear search (could optimize with binary search for large lists)
  for (const range of DATACENTER_RANGES) {
    if (ipNum >= range.start && ipNum <= range.end) {
      return { isDatacenter: true, provider: range.provider };
    }
  }

  return { isDatacenter: false, provider: null };
}

// Calculate bot score based on various signals
export interface BotSignals {
  isWebdriver: boolean;
  suspiciousUA: boolean;
  linearMovement: boolean;
  datacenterIP: boolean;
  hasMouseMoved: boolean;
  hasTouched: boolean;
  hasScrolled: boolean;
  hasKeyPressed: boolean;
  timeOnPage: number;
}

export function calculateBotScore(signals: BotSignals): number {
  let score = 0;

  // Strong signals (high weight)
  if (signals.isWebdriver) score += 40;
  if (signals.suspiciousUA) score += 30;

  // Medium signals
  if (signals.datacenterIP) score += 25;
  if (signals.linearMovement) score += 20;

  // Weak signals (lack of human behavior)
  if (!signals.hasMouseMoved && !signals.hasTouched) score += 15;
  if (!signals.hasScrolled) score += 10;
  if (!signals.hasKeyPressed) score += 5;

  // Time-based signals
  if (signals.timeOnPage < 1000) score += 15; // Less than 1 second
  else if (signals.timeOnPage < 2000) score += 10; // Less than 2 seconds
  else if (signals.timeOnPage < 3000) score += 5; // Less than 3 seconds

  return Math.min(score, 100);
}
