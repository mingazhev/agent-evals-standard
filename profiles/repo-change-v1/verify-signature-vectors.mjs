import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VECTOR_PATH = fileURLToPath(new URL("./signature-conformance-vectors.json", import.meta.url));
const PROFILE_PATH = fileURLToPath(new URL("./signature-profile.json", import.meta.url));
const TRUST_PATH = fileURLToPath(new URL("./signature-trust-contract.json", import.meta.url));
const ANTI_ROLLBACK_PATH = fileURLToPath(new URL("./anti-rollback-policy.json", import.meta.url));
const IMPLEMENTATION_PIN_PATH = fileURLToPath(new URL("./evid-001-signature-implementation-contract.json", import.meta.url));
const TRUST_ANCHOR_PATH = fileURLToPath(new URL("../../conformance/fixtures/keys/rfc8032-test-key-1.pem", import.meta.url));
const ED25519_SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const P256_ORDER = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const P256_HALF_ORDER = P256_ORDER >> 1n;
const PROFILE_ID = "fixture-signature-profile";
const PS256_PARAMETERS = Object.freeze({
  hash: "sha256",
  mgf: "MGF1",
  mgfHash: "sha256",
  saltLengthBytes: 32,
  modulusBits: 2048,
});
const PINNED_PUBLIC_KEYS = Object.freeze({
  ed25519: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=\n-----END PUBLIC KEY-----\n",
  p256: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEc+O2WDV9KCh2fQMSYg3oTpy6UU27\nceTR/pduuJqRNrAS5OYgPWaW8q99SgEWIW2MIbLx6D+0b5jxRZT3MnPF8g==\n-----END PUBLIC KEY-----\n",
  rsa2048: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtp6IK56UBkMdoONuzjTv\nvogwUEIOkxdf4ZTjt4paIU/wvpoPofYJ3Ap0s+yA1J46PKMTD05FlJvMzR+PwWkJ\ndBo3UyRtkIg6Gy2bncPw82IaxcR/caCIaYSeR5xNAboCrpzHJe0DoTZjJZUGYRta\nSCoZiSgktT7+g98psciK/wktlQp9Kz1YncssKZ/TjXHh9MYn1cSlipU9Fc56EJ5N\nhVjuJErhzaBAybkEaPu39cnTRm6Jj0epwC5ENNVhKrGpoKoVDjfqkHwSllQB7u8T\nRW264dgQHTN/KFMmZHOF3rTNlMRjKAa7H6phx6YivFMCZ3f7x4zaJy4FhiUHOnx5\ncwIDAQAB\n-----END PUBLIC KEY-----\n",
  rsa1024: "-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDyMZWT5pHTBsE8cDUHOCBcH4VH\noL88GCT1G62FoZvIsmKEdXomdlUZkVFIm2cMkHc5RIesVZEGB8Sc2zLnXqFJb/y7\nwhGbM9yRGhSKo1Z9dcsOzBF2LDk1dvWywU3ucXEhRtbpJ8Hypa8uCpN6zJQktSy+\npZVKV4ZHcjOlEP1uIwIDAQAB\n-----END PUBLIC KEY-----\n",
});
const PINNED_SIGNATURES = Object.freeze({
  ed25519: "Jixc0zS_GCT3G1EvQ8vhK6gwrmSFw7an4goU3OU4vjCWrdIP0Jf4nSgpqLuD9yzkH6dq1K1xG_ZvooXvDmh7AA",
  es256LowS: "zHrcz-GApbfz3ls8PPk-GtwvqXpTmC6gY_Xe_M4uPx4vRtO59EQ4pq2D6kbxUjLXG7gizImwGLZuJHmNAdK3_A",
  ps256: "I5LRcFeLe4zKrsayWAjknzuf6APERN5u0s9G_CO6Uq7zslbG5ILoEnpEswayduZX-lu0KpLm-WDJHy1-cSftVEmi-2wPyKH3J3nWLh2-u3J9lhYEltYeEx5qoNK7zWntRRQiwP_GzStdvPkOCeyIipkR9V9nLBvUFnlzyz8uXbQExGNHKPW2nvYsADwXysvZ_dD90tLiHa3D3dkZB9__ild2DBqrLIPmYQ_UHA8rzmPR4euTvuyBxgpznjsznDeJiGdW9z_RP8lPKcnTArgkkNOY_mlYO2fehHU3PECcfwlDq9ION2-B5R04nkXWkIjL2bTPy5u6sA7F9-LrnZRLMA",
  ps256WrongSalt: "CoptpmsKnnuyuDWfd8mKFj0qHLWNZkwFQlCYBK44LD13hfzoasyaVIdZWBfINQy1_iBDa9ZJF0irFxjrZJznFRI-UFwvSxgnKKvEimBmyAb5iOZZdNB8ho-vaVy-0FoIcfxKTjXAgcAmGNpXWalW9IsZf6jg3PrDA1vO05-sex_H9QkscIQcfGTz__6fRkXv4JBJGTg3Qufilj7v-neRyHmk0fhIM5s7ahABwKAv01JQ7-0JNkRx6kdl2Uoennf0xFtgfznu5uqHZt2DMKI8hUr3y4gslRt18N8fYGtzefCB_kDzOD3ldSkwQ-cDk_sQtqp3L3rQGfyIHygqN_xHyQ",
  ps256WrongMgfHash: "aqLoVAy1aJl9JioB7m2nElcWBfmmNEmxnikDEEjKxRMkbTAabDAWz_pf45TJ7vQDJBalMFk8fT3kY0P1VU2Y9mwxWD-3-EgayPP2Bda_y5W-a-ba08OcsCct55JwFH0ivwRG5dC07pwYDlI8d96iwhrjsX2dzyhO4-XAYugIPO26JkB8L-S4YcoB--U70sL4L1mD4tJAb-zqLEeXO_KV0jFuux2P3LH4Lne-oUTdcjVdX3PWlKnrvSE5vMUw1JFXtJ2eHI7Y4YkQime0M1xCGAWTU7NRoD8DC35mRGTeH1bmCf1hjiK8qmZ82CwhZT_xr54qaMa1_2w130ahMGImXQ",
  ps256SmallKey: "e-hUj5QGjdJQ9IlicJvBeKng1lRH9oNxYfR-DrP_u2Dk-B0bzJpDTI77gTNhsQ-YYYhyKPafEiLM5bw2XX7KlnKhEVThbjLqt9nG1hU-Pq91DveC81gnyUQnzIKie6jdh1FaWDRilXjbVxv7_FVJqX2fdiDEFhhMydJloLVQjwA",
  ps256OriginalForAlteredPayload: "jI5EiYbLAsAiFsplsICxuVZYuO5M9hg2Ynbxl5ytqH2DBM08Q6RQjcRAMVfPCq3eB8rniQruFlJQ3cHLcjxqFCGi9mIqEW9yrgjxRSWGGaSPrcawq-POq-fFza8o9vbsH3688H7FDwmk0g64q2Kdusa_9vkdTzzQGn6q3UE2vhS7noEIwRBIZbuKndkHAa1Qo2e8zb_7WKojMuh39zJ5CZMGD_NkSo0PPVfSV7I6fVy13uIb1b_QGbgHE99HaQWTCe-DnPFF4uueZeRY_kTXBjK-Cs5rnqKvEuNgx1GlLZcn_y-_1WZNSOvxHirMUHu24A4tdQh4ujNbi_v2Lg5hxQ",
});
const HASH_ALGORITHM_IDENTIFIERS = Object.freeze({
  sha256: Buffer.from("300d06096086480165030402010500", "hex"),
  sha384: Buffer.from("300d06096086480165030402020500", "hex"),
});
const RSA_PSS_OID = Buffer.from("06092a864886f70d01010a", "hex");
const MGF1_OID = Buffer.from("06092a864886f70d010108", "hex");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function b64u(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fromB64u(value) {
  return Buffer.from(value, "base64url");
}

function sha256Digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function selfDigest(artifact) {
  const projection = clone(artifact);
  delete projection.digest;
  delete projection.signature;
  return sha256Digest(Buffer.from(canonical(projection), "utf8"));
}

function signingBytes(artifact) {
  const projection = clone(artifact);
  delete projection.signature.value;
  return Buffer.concat([
    Buffer.from(artifact.schemaVersion, "ascii"),
    Buffer.from([0]),
    Buffer.from(canonical(projection), "utf8"),
  ]);
}

function bigintToBuffer(value, length) {
  const hex = value.toString(16).padStart(length * 2, "0");
  return Buffer.from(hex, "hex");
}

function bufferToBigint(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const octets = [];
  for (let value = length; value > 0; value >>= 8) octets.unshift(value & 0xff);
  return Buffer.from([0x80 | octets.length, ...octets]);
}

function der(tag, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function derInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`unsupported DER integer ${value}`);
  let hex = value.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  let bytes = Buffer.from(hex, "hex");
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
  return der(0x02, bytes);
}

// Node's verify() exposes saltLength but not MGF1's digest for a generic RSA
// key. Importing the same modulus as an RFC 8017 RSA-PSS SubjectPublicKeyInfo
// makes OpenSSL enforce hash, MGF1 hash, and minimum salt parameters itself.
function rsaPssPublicKey(publicKeyPem, parameters) {
  if (parameters.mgf !== "MGF1") throw new Error(`unsupported mask generation function ${parameters.mgf}`);
  const hashIdentifier = HASH_ALGORITHM_IDENTIFIERS[parameters.hash];
  const mgfHashIdentifier = HASH_ALGORITHM_IDENTIFIERS[parameters.mgfHash];
  if (!hashIdentifier || !mgfHashIdentifier) throw new Error("unsupported RSA-PSS hash parameter");
  const rsaKey = createPublicKey(publicKeyPem);
  if (rsaKey.asymmetricKeyType !== "rsa") throw new Error(`expected RSA key, found ${rsaKey.asymmetricKeyType}`);
  const rsaPublicKey = rsaKey.export({ format: "der", type: "pkcs1" });
  const pssParameters = der(
    0x30,
    der(0xa0, hashIdentifier),
    der(0xa1, der(0x30, MGF1_OID, mgfHashIdentifier)),
    der(0xa2, derInteger(parameters.saltLengthBytes)),
  );
  const algorithmIdentifier = der(0x30, RSA_PSS_OID, pssParameters);
  const subjectPublicKey = der(0x03, Buffer.from([0]), rsaPublicKey);
  const pssKey = createPublicKey({ key: der(0x30, algorithmIdentifier, subjectPublicKey), format: "der", type: "spki" });
  const details = pssKey.asymmetricKeyDetails;
  if (pssKey.asymmetricKeyType !== "rsa-pss"
      || details?.hashAlgorithm !== parameters.hash
      || details?.mgf1HashAlgorithm !== parameters.mgfHash
      || details?.saltLength !== parameters.saltLengthBytes) {
    throw new Error("OpenSSL did not preserve the requested RSA-PSS key restrictions");
  }
  return pssKey;
}

function nativePssVerify(vector, parameters) {
  try {
    const key = rsaPssPublicKey(vector.publicKeyPem, parameters);
    return verify(parameters.hash, fromB64u(vector.messageBase64url), {
      key,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: parameters.saltLengthBytes,
    }, fromB64u(vector.signatureBase64url));
  } catch {
    return false;
  }
}

function rsaModulusBits(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  return key.asymmetricKeyType === "rsa" ? key.asymmetricKeyDetails?.modulusLength : undefined;
}

function cryptographicValidity(vector) {
  const message = fromB64u(vector.messageBase64url);
  const signature = fromB64u(vector.signatureBase64url);
  try {
    if (vector.algorithm === "Ed25519") return verify(null, message, vector.publicKeyPem, signature);
    if (vector.algorithm === "ES256") {
      return verify("sha256", message, { key: vector.publicKeyPem, dsaEncoding: "ieee-p1363" }, signature);
    }
    if (vector.algorithm === "PS256") {
      return nativePssVerify(vector, vector.generatedWith);
    }
  } catch {
    return false;
  }
  return false;
}

function profileAccepts(vector, cryptographicallyValid) {
  if (!cryptographicallyValid) return false;
  if (vector.claimedAlgorithm !== vector.algorithm) return false;
  const signature = fromB64u(vector.signatureBase64url);
  if (vector.algorithm === "Ed25519") return signature.length === 64;
  if (vector.algorithm === "ES256") {
    if (signature.length !== 64) return false;
    const r = bufferToBigint(signature.subarray(0, 32));
    const s = bufferToBigint(signature.subarray(32));
    return r > 0n && r < P256_ORDER && s > 0n && s <= P256_HALF_ORDER;
  }
  if (vector.algorithm === "PS256") {
    const modulusBits = rsaModulusBits(vector.publicKeyPem);
    return vector.generatedWith.hash === "sha256"
      && vector.generatedWith.mgf === "MGF1"
      && vector.generatedWith.mgfHash === "sha256"
      && vector.generatedWith.saltLengthBytes === 32
      && vector.generatedWith.modulusBits === modulusBits
      && modulusBits >= 2048
      && signature.length === Math.ceil(modulusBits / 8)
      && nativePssVerify(vector, PS256_PARAMETERS);
  }
  return false;
}

function makeVector(id, algorithm, kind, keyId, publicKeyPem, message, signature, generatedWith, expectedCryptographicValidity, expectedProfileVerdict) {
  return {
    id,
    algorithm,
    claimedAlgorithm: algorithm,
    kind,
    keyId,
    publicKeyPem,
    messageBase64url: b64u(message),
    signatureBase64url: b64u(signature),
    generatedWith,
    expectedCryptographicValidity,
    expectedProfileVerdict,
  };
}

function generateCorpus() {
  const edPrivate = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, ED25519_SEED]),
    format: "der",
    type: "pkcs8",
  });
  const edPublic = PINNED_PUBLIC_KEYS.ed25519;
  const ecPublic = PINNED_PUBLIC_KEYS.p256;
  const rsa2048Public = PINNED_PUBLIC_KEYS.rsa2048;
  const rsa1024Public = PINNED_PUBLIC_KEYS.rsa1024;
  const message = Buffer.from("agent-evals signature profile conformance vector v1", "utf8");
  const alteredMessage = Buffer.from("agent-evals signature profile conformance vector v1 altered", "utf8");
  const edSignature = fromB64u(PINNED_SIGNATURES.ed25519);
  const esLow = fromB64u(PINNED_SIGNATURES.es256LowS);
  const esHigh = Buffer.concat([esLow.subarray(0, 32), bigintToBuffer(P256_ORDER - bufferToBigint(esLow.subarray(32)), 32)]);
  const esZeroR = Buffer.concat([Buffer.alloc(32), esLow.subarray(32)]);
  const psBase = { ...PS256_PARAMETERS };
  const psWrongSalt = { ...psBase, saltLengthBytes: 20 };
  const psWrongMgf = { ...psBase, mgfHash: "sha384" };
  const psSmall = { ...psBase, modulusBits: 1024 };
  const psPositive = fromB64u(PINNED_SIGNATURES.ps256);
  const vectors = [
    makeVector("ed25519-positive", "Ed25519", "positive", "rfc8032-test-key-1", edPublic, message, edSignature, { mode: "pure" }, true, "accept"),
    makeVector("ed25519-altered-payload", "Ed25519", "cryptographic_negative", "rfc8032-test-key-1", edPublic, alteredMessage, edSignature, { mode: "pure" }, false, "reject"),
    makeVector("ed25519-malformed-encoding", "Ed25519", "cryptographic_negative", "rfc8032-test-key-1", edPublic, message, edSignature.subarray(0, 63), { mode: "pure" }, false, "reject"),
    makeVector("ed25519-wrong-key-type", "Ed25519", "cryptographic_negative", "generated-p256-vector-key", ecPublic, message, edSignature, { mode: "pure" }, false, "reject"),
    { ...makeVector("ed25519-algorithm-substitution", "Ed25519", "profile_negative", "rfc8032-test-key-1", edPublic, message, edSignature, { mode: "pure" }, true, "reject"), claimedAlgorithm: "ES256" },
    makeVector("es256-low-s-positive", "ES256", "positive", "generated-p256-vector-key", ecPublic, message, esLow, { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, true, "accept"),
    makeVector("es256-high-s-profile-negative", "ES256", "profile_negative", "generated-p256-vector-key", ecPublic, message, esHigh, { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, true, "reject"),
    makeVector("es256-zero-r-negative", "ES256", "cryptographic_negative", "generated-p256-vector-key", ecPublic, message, esZeroR, { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, false, "reject"),
    makeVector("es256-altered-payload", "ES256", "cryptographic_negative", "generated-p256-vector-key", ecPublic, alteredMessage, esLow, { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, false, "reject"),
    makeVector("es256-malformed-encoding", "ES256", "cryptographic_negative", "generated-p256-vector-key", ecPublic, message, esLow.subarray(0, 63), { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, false, "reject"),
    makeVector("es256-wrong-key-type", "ES256", "cryptographic_negative", "generated-rsa-2048-vector-key", rsa2048Public, message, esLow, { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, false, "reject"),
    { ...makeVector("es256-algorithm-substitution", "ES256", "profile_negative", "generated-p256-vector-key", ecPublic, message, esLow, { curve: "P-256", hash: "sha256", encoding: "raw_r_s" }, true, "reject"), claimedAlgorithm: "PS256" },
    makeVector("ps256-positive", "PS256", "positive", "generated-rsa-2048-vector-key", rsa2048Public, message, psPositive, psBase, true, "accept"),
    makeVector("ps256-wrong-salt-length", "PS256", "profile_negative", "generated-rsa-2048-vector-key", rsa2048Public, message, fromB64u(PINNED_SIGNATURES.ps256WrongSalt), psWrongSalt, true, "reject"),
    makeVector("ps256-wrong-mgf-hash", "PS256", "profile_negative", "generated-rsa-2048-vector-key", rsa2048Public, message, fromB64u(PINNED_SIGNATURES.ps256WrongMgfHash), psWrongMgf, true, "reject"),
    makeVector("ps256-undersized-modulus", "PS256", "profile_negative", "generated-rsa-1024-vector-key", rsa1024Public, message, fromB64u(PINNED_SIGNATURES.ps256SmallKey), psSmall, true, "reject"),
    makeVector("ps256-altered-payload", "PS256", "cryptographic_negative", "generated-rsa-2048-vector-key", rsa2048Public, alteredMessage, fromB64u(PINNED_SIGNATURES.ps256OriginalForAlteredPayload), psBase, false, "reject"),
    makeVector("ps256-malformed-encoding", "PS256", "cryptographic_negative", "generated-rsa-2048-vector-key", rsa2048Public, message, psPositive.subarray(1), psBase, false, "reject"),
    makeVector("ps256-wrong-key-type", "PS256", "cryptographic_negative", "generated-p256-vector-key", ecPublic, message, psPositive, psBase, false, "reject"),
    { ...makeVector("ps256-algorithm-substitution", "PS256", "profile_negative", "generated-rsa-2048-vector-key", rsa2048Public, message, psPositive, psBase, true, "reject"), claimedAlgorithm: "Ed25519" },
  ];
  const artifact = {
    schemaVersion: "agent-evals-signature-conformance-vectors-1",
    id: "fixture-signature-vectors-v1",
    version: "0.1.0",
    profileId: PROFILE_ID,
    generatedAt: "2026-08-01T00:00:00Z",
    vectors,
    digest: "",
    signature: {
      profileId: PROFILE_ID,
      algorithm: "Ed25519",
      keyId: "rfc8032-test-key-1",
      signedAt: "2026-08-01T00:00:00Z",
      value: "",
    },
  };
  artifact.digest = selfDigest(artifact);
  artifact.signature.value = b64u(sign(null, signingBytes(artifact), edPrivate));
  return artifact;
}

function validateCorpus(artifact) {
  const failures = [];
  if (artifact.profileId !== PROFILE_ID) failures.push(`profileId: expected ${PROFILE_ID}`);
  if (artifact.digest !== selfDigest(artifact)) failures.push("artifact self-digest mismatch");
  const signatureValid = verify(
    null,
    signingBytes(artifact),
    createPublicKey(PINNED_PUBLIC_KEYS.ed25519),
    fromB64u(artifact.signature.value),
  );
  if (!signatureValid) failures.push("artifact signature invalid");
  const requiredIds = new Set([
    "ed25519-positive",
    "ed25519-altered-payload",
    "ed25519-malformed-encoding",
    "ed25519-wrong-key-type",
    "ed25519-algorithm-substitution",
    "es256-low-s-positive",
    "es256-high-s-profile-negative",
    "es256-zero-r-negative",
    "es256-altered-payload",
    "es256-malformed-encoding",
    "es256-wrong-key-type",
    "es256-algorithm-substitution",
    "ps256-positive",
    "ps256-wrong-salt-length",
    "ps256-wrong-mgf-hash",
    "ps256-undersized-modulus",
    "ps256-altered-payload",
    "ps256-malformed-encoding",
    "ps256-wrong-key-type",
    "ps256-algorithm-substitution",
  ]);
  const permittedIds = new Set(requiredIds);
  const seenIds = new Set();
  const ps256BoundaryExpectations = new Map([
    ["ps256-positive", { strictCryptographicValidity: true, modulusBits: 2048 }],
    ["ps256-wrong-salt-length", { strictCryptographicValidity: false, modulusBits: 2048 }],
    ["ps256-wrong-mgf-hash", { strictCryptographicValidity: false, modulusBits: 2048 }],
    ["ps256-undersized-modulus", { strictCryptographicValidity: true, modulusBits: 1024 }],
  ]);
  for (const vector of artifact.vectors) {
    if (!permittedIds.has(vector.id)) failures.push(`unexpected vector ${vector.id}`);
    if (seenIds.has(vector.id)) failures.push(`duplicate vector ${vector.id}`);
    seenIds.add(vector.id);
    requiredIds.delete(vector.id);
    const cryptoValid = cryptographicValidity(vector);
    const verdict = profileAccepts(vector, cryptoValid) ? "accept" : "reject";
    if (cryptoValid !== vector.expectedCryptographicValidity) failures.push(`${vector.id}: cryptographic validity ${cryptoValid}`);
    if (verdict !== vector.expectedProfileVerdict) failures.push(`${vector.id}: profile verdict ${verdict}`);
    const boundaryExpectation = ps256BoundaryExpectations.get(vector.id);
    if (boundaryExpectation) {
      const strictCryptographicValidity = nativePssVerify(vector, PS256_PARAMETERS);
      const modulusBits = rsaModulusBits(vector.publicKeyPem);
      if (strictCryptographicValidity !== boundaryExpectation.strictCryptographicValidity) {
        failures.push(`${vector.id}: strict PS256 OpenSSL validity ${strictCryptographicValidity}`);
      }
      if (modulusBits !== boundaryExpectation.modulusBits) {
        failures.push(`${vector.id}: actual RSA modulus is ${modulusBits} bits`);
      }
    }
  }
  for (const missing of requiredIds) failures.push(`missing required vector ${missing}`);
  if (failures.length) throw new Error(failures.join("\n"));
  return artifact.vectors.length;
}

function validateSignedArtifact(artifact, label, publicKey) {
  if (artifact.digest !== selfDigest(artifact)) throw new Error(`${label}: self-digest mismatch`);
  if (artifact.signature.profileId !== PROFILE_ID) throw new Error(`${label}: wrong signature profileId`);
  if (!verify(null, signingBytes(artifact), publicKey, fromB64u(artifact.signature.value))) {
    throw new Error(`${label}: signature invalid`);
  }
}

function validateBundle(vectorArtifact) {
  const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
  const trust = JSON.parse(readFileSync(TRUST_PATH, "utf8"));
  const antiRollback = JSON.parse(readFileSync(ANTI_ROLLBACK_PATH, "utf8"));
  const implementationPin = JSON.parse(readFileSync(IMPLEMENTATION_PIN_PATH, "utf8"));
  const publicKey = createPublicKey(readFileSync(TRUST_ANCHOR_PATH));
  validateSignedArtifact(trust, "signature trust contract", publicKey);
  validateSignedArtifact(antiRollback, "anti-rollback policy", publicKey);
  validateSignedArtifact(implementationPin, "EVID-001 implementation pin", publicKey);
  if (profile.digest !== selfDigest(profile)) throw new Error("signature profile: self-digest mismatch");
  if (profile.algorithmConformanceVectors.digest !== vectorArtifact.digest) throw new Error("signature profile: vector pointer mismatch");
  if (profile.keyResolutionContract.digest !== trust.digest
      || profile.revocationContract.digest !== trust.digest
      || profile.timeValidationContract.digest !== trust.digest) {
    throw new Error("signature profile: trust-contract pointer mismatch");
  }
  if (profile.antiRollbackPolicy.digest !== antiRollback.digest) throw new Error("signature profile: anti-rollback pointer mismatch");
  if (implementationPin.signatureProfile.digest !== profile.digest) throw new Error("EVID-001 implementation pin: profile pointer mismatch");
  if (trust.keys[0].publicKeyDigest !== sha256Digest(readFileSync(TRUST_ANCHOR_PATH))) {
    throw new Error("signature trust contract: trust-anchor digest mismatch");
  }
  return { profile, trust, antiRollback, implementationPin };
}

if (process.argv.includes("--generate")) {
  process.stdout.write(`${JSON.stringify(generateCorpus(), null, 2)}\n`);
} else {
  const corpusBytes = readFileSync(VECTOR_PATH);
  const regeneratedBytes = Buffer.from(`${JSON.stringify(generateCorpus(), null, 2)}\n`, "utf8");
  if (!corpusBytes.equals(regeneratedBytes)) {
    throw new Error("signature corpus is not byte-for-byte reproducible from its pinned keys and signatures");
  }
  const artifact = JSON.parse(corpusBytes.toString("utf8"));
  const count = validateCorpus(artifact);
  const bundle = validateBundle(artifact);
  process.stdout.write(`signature vectors: ${count} passed; digest ${artifact.digest}\n`);
  process.stdout.write(`signature bundle: profile ${bundle.profile.digest}; anti-rollback ${bundle.antiRollback.digest}; trust ${bundle.trust.digest}; pin ${bundle.implementationPin.digest}\n`);
}
