const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const users = new Map();
const roleNames = new Set([
  "PRODUCER",
  "PROCESSOR",
  "TRANSPORTER",
  "WAREHOUSE",
  "RETAILER",
  "AUDITOR",
]);

function signingKey(orgId) {
  return process.env[`ORG_${String(orgId).toUpperCase()}_PRIVATE_KEY`];
}

async function register({ email, password, orgId, role }) {
  if (!email || !password || !orgId || !role || !roleNames.has(role)) {
    throw new Error("email, password, orgId, and a valid role are required");
  }
  if (users.has(email.toLowerCase())) throw new Error("User already exists");
  if (!signingKey(orgId)) throw new Error("Organization signing key is not configured");
  const user = {
    userId: crypto.randomUUID(),
    email: email.toLowerCase(),
    passwordHash: await bcrypt.hash(password, 12),
    orgId,
    role,
    privateKey: signingKey(orgId),
  };
  users.set(user.email, user);
  return user;
}

async function login(email, password) {
  const user = users.get(String(email).toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new Error("Invalid credentials");
  }
  const token = jwt.sign(
    { userId: user.userId, email: user.email, orgId: user.orgId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  return { token, user: { userId: user.userId, email: user.email, orgId: user.orgId, role: user.role } };
}

function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) throw new Error("Bearer token required");
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const user = users.get(req.user.email);
    if (user) req.user.privateKey = user.privateKey;
    next();
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Insufficient role" });
    next();
  };
}

module.exports = { register, login, authenticate, requireRole };
