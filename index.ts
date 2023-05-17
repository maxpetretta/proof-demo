import type { Identity } from "@semaphore-protocol/identity";
import type { FullProof, Proof } from "@semaphore-protocol/proof";
import { generateProof, verifyProof } from "@semaphore-protocol/proof";
import type { MerkleProof } from "@zk-kit/incremental-merkle-tree";
import fetch from "node-fetch";
import { BigNumber, BytesLike, ethers } from "ethers";

const encode = (value: bigint): string => {
  return "0x" + value.toString(16).padStart(64, "0");
};

// Lifted from @semaphore-protocol/proof internals
function hash(message: BytesLike | number | bigint): bigint {
  message = BigNumber.from(message).toTwos(256).toHexString();
  message = ethers.utils.zeroPad(message, 32);

  return BigInt(ethers.utils.keccak256(message)) >> BigInt(8);
}

// Lifted from previous simulator implementation
function getMerkleProof(inclusionProof): MerkleProof {
  const siblings = inclusionProof.proof
    .flatMap((v) => Object.values(v))
    .map((v) => BigInt(v));

  const pathIndices = inclusionProof.proof
    .flatMap((v) => Object.keys(v))
    .map((v) => (v == "Left" ? 0 : 1));

  return {
    root: null,
    leaf: null,
    siblings: siblings,
    pathIndices: pathIndices,
  } as MerkleProof;
}

// Lifted from new simulator implementation
async function getFullProof(
  trapdoor: bigint,
  nullifier: bigint,
  commitment: bigint,
  merkleProof: MerkleProof,
  externalNullifier: bigint,
  signal: bigint
): Promise<FullProof> {
  const identity = {
    trapdoor,
    nullifier,
    commitment,
  } as Identity;

  return await generateProof(identity, merkleProof, externalNullifier, signal, {
    zkeyFilePath: "./semaphore/semaphore_30.zkey",
    wasmFilePath: "./semaphore/semaphore_30.wasm",
  });
}

// Lifted from new simulator implementation
async function verifySemaphoreProof(
  trapdoor: bigint,
  nullifier: bigint,
  commitment: bigint,
  signal: bigint,
  externalNullifier: bigint,
  inclusionProof: any
) {
  try {
    // Generate proofs
    const merkleProof = getMerkleProof(inclusionProof);
    const fullProof = await getFullProof(
      trapdoor,
      nullifier,
      commitment,
      merkleProof,
      externalNullifier,
      signal
    );

    // Verify the full proof
    const verified = await verifyProof(fullProof, 30);
    return { verified, fullProof };
  } catch (error) {
    console.error(error);
  }
}

// Happens on dev portal before verify request
function decodeProof(proof: Proof) {
  const hexArray = proof.map((item) => ethers.utils.hexlify(BigInt(item)));

  return [
    [hexArray[0], hexArray[1]],
    [
      [hexArray[2], hexArray[3]],
      [hexArray[4], hexArray[5]],
    ],
    [hexArray[6], hexArray[7]],
  ];
}

/****************** Main execution ******************/

// Hardcoded identity for testing, 0x0f60b106802a76f60d9437d7d47c8e910bb27576e1a915f74f8dddbf0c7e6d8f
const trapdoor =
  BigInt(
    9644825562470560826432269571592096081179871958250335623023934310543320809493n
  );
const nullifier =
  BigInt(
    7607103733496294409522837028138481127552819970553478817140046706792026434803n
  );
const commitment =
  BigInt(
    6955531831328224948550471259098061163833538412083608752424993628946872298895n
  );

// Generate a random identity, needs to be inserted manually
// const identity = new Identity();
// const { trapdoor, nullifier, commitment } = identity;

// Signal and external nullifier values
const signal =
  BigInt(
    349520125851268261087593898257781118122351904114639672919570969471416632740n
  ); // 0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4, empty string hash
const externalNullifier =
  BigInt(
    438341265544480334931959214128234941862722733458111179385814427732706419673n
  ); // 0xf817a52ebd5ce11a00e6ad81be01471df49e988f45bce0dfdde98bbd7563d9, generateExternalNullifier("app_staging_bcaaa4bc36b0d07dc3b4bf826de6e986", "test")

// Fetch inclusion proof from signup sequencer
const response = await fetch(
  "https://signup-batching.stage-crypto.worldcoin.dev/inclusionProof",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identityCommitment: encode(commitment),
    }),
  }
);

let inclusionProof: any;
if (response.status === 200) {
  inclusionProof = await response.json();
} else {
  throw new Error("Failed to fetch inclusion proof");
}

// Generate the full proof using @semaphore-protocol/proof
const verification = await verifySemaphoreProof(
  trapdoor,
  nullifier,
  commitment,
  signal,
  externalNullifier,
  inclusionProof
);

// Verify the full proof
if (verification?.verified) {
  const body = {
    root: inclusionProof.root,
    nullifierHash: encode(BigInt(verification.fullProof.nullifierHash)),
    externalNullifierHash: encode(
      hash(BigInt(verification.fullProof.externalNullifier))
    ),
    signalHash: encode(hash(BigInt(verification.fullProof.signal))),
    proof: decodeProof(verification.fullProof.proof),
  };

  const verifyResponse = await fetch(
    "https://signup-batching.stage-crypto.worldcoin.dev/verifySemaphoreProof",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  console.log(
    "🚀 ~ file: index.ts:163 ~ verifyResponse.status:",
    verifyResponse.status
  );
  console.log(
    "🚀 ~ file: index.ts:163 ~ verifyResponse.text():",
    await verifyResponse.text()
  );
}
