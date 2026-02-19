// scheduleRefund.ts

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    PublicKey,
    TransactionInstruction,
    SystemProgram,
} from "@solana/web3.js";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
} from "@solana/spl-token";
import { init as initTuktuk, compileTransaction } from "@helium/tuktuk-sdk";
import * as fs from "fs";

const RPC_URL = "https://api.devnet.solana.com";
const ESCROW_PROGRAM_ID = new PublicKey("3guFRQANk2kcU4LQVekbw7T8iF1jts85FDuz8JzQEjvp");
const TASK_QUEUE_PUBKEY = new PublicKey("CeGL4pscmADpfSLrmn6Dtnu4otvN6NPvX2AcW8SAPwfu");
// ^ Get this by running: tuktuk -u <url> task-queue list

// Derive the escrow PDA

function deriveEscrowPDA(maker: PublicKey, seed: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [
            Buffer.from("escrow"),
            maker.toBuffer(),
            seed.toArrayLike(Buffer, "le", 8),
        ],
        ESCROW_PROGRAM_ID
    );
}

// HELPER: Get the 8-byte Anchor instruction discriminator

function getInstructionDiscriminator(name: string): Buffer {
    const preimage = `global:${name}`;
    const { createHash } = require("crypto");
    const hash = createHash("sha256").update(preimage).digest();
    return Buffer.from(hash.slice(0, 8));
}


// Schedule a refund task with TukTuk
async function scheduleEscrowRefund({
    callerKeypair,   // whoever is paying for the TukTuk task (can be your backend wallet)
    makerPubkey,     // the maker of the escrow
    mintAPubkey,     // the mint_a used in the escrow
    seed,            // the u64 seed used when creating the escrow
    expiryTimestamp, // unix timestamp — when TukTuk should fire the refund
}: {
    callerKeypair: Keypair;
    makerPubkey: PublicKey;
    mintAPubkey: PublicKey;
    seed: BN;
    expiryTimestamp: number;
}) {
    const connection = new Connection(RPC_URL, "confirmed");
    const wallet = new Wallet(callerKeypair);
    const provider = new AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });

    // Init TukTuk SDK ──────────────────────────────────
    const tuktukProgram = await initTuktuk(provider);

    // Derive all the accounts your refund instruction needs ──
    const [escrowPDA] = deriveEscrowPDA(makerPubkey, seed);

    // vault = ATA of mint_a owned by the escrow PDA
    const vaultPubkey = await getAssociatedTokenAddress(
        mintAPubkey,
        escrowPDA,
        true // allowOwnerOffCurve: true because escrow is a PDA
    );

    // maker_ata_a = maker's own token account for mint_a
    const makerAtaA = await getAssociatedTokenAddress(
        mintAPubkey,
        makerPubkey
    );

    // Build the raw refund instruction ────────────────
    const discriminator = getInstructionDiscriminator("refund");

    const refundInstruction = new TransactionInstruction({
        programId: ESCROW_PROGRAM_ID,
        keys: [
            { pubkey: makerPubkey, isSigner: false, isWritable: true },  // maker
            { pubkey: mintAPubkey, isSigner: false, isWritable: false }, // mint_a
            { pubkey: makerAtaA, isSigner: false, isWritable: true },  // maker_ata_a
            { pubkey: escrowPDA, isSigner: false, isWritable: true },  // escrow
            { pubkey: vaultPubkey, isSigner: false, isWritable: true },  // vault
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        ],
        data: discriminator,
    });

    // 4. Compile the transaction for TukTuk 
    const { transaction, remainingAccounts } = await compileTransaction(
        [refundInstruction],
        []
    );

    // Find the next available task ID in the queue
    const taskQueueAccount = await tuktukProgram.account.taskQueueV0.fetch(
        TASK_QUEUE_PUBKEY
    );
    const taskId = taskQueueAccount.taskBitmap.findIndex(
        (slot: number) => slot === 0
    );
    if (taskId === -1) throw new Error("Task queue is full!");

    //  Queue the task on TukTuk 
    const [taskPDA] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("task"),
            TASK_QUEUE_PUBKEY.toBuffer(),
            Buffer.from([taskId]),
        ],
        tuktukProgram.programId
    );

    const tx = await tuktukProgram.methods
        .queueTaskV0({
            id: taskId,

            // "timestamp" trigger = run ONCE at this exact unix time
            trigger: {
                timestamp: {
                    0: new BN(expiryTimestamp),  // ✅ Wrapped in object with key "0"
                },
            },

            // Pack the compiled refund instruction
            transaction: {
                compileV0: {
                    transaction,
                    remainingAccounts,
                },
            },

            // Optional: description helps you find the task in CLI later
            description: `refund-escrow-${escrowPDA.toBase58().slice(0, 8)}`,

            // Use the queue's default crank reward (null = use default)
            crankReward: null,

            // How many times TukTuk will retry if the tx fails
            freeTasksAfterRun: 0,
            freeTasks: 0
        })
        .accounts({
            payer: callerKeypair.publicKey,
            taskQueue: TASK_QUEUE_PUBKEY,
            task: taskPDA,
        })
        .signers([callerKeypair])
        .rpc();

    console.log(`✅ Refund scheduled!`);
    console.log(`   Escrow:    ${escrowPDA.toBase58()}`);
    console.log(`   Task PDA:  ${taskPDA.toBase58()}`);
    console.log(`   Fires at:  ${new Date(expiryTimestamp * 1000).toISOString()}`);
    console.log(`   TukTuk tx: ${tx}`);

    return { taskPDA, escrowPDA };
}

// Call this right after make() succeeds
async function main() {
    const keypairData = JSON.parse(
        fs.readFileSync(process.env.KEYPAIR_PATH ?? "~/.config/solana/id.json", "utf8")
    );
    const callerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

    const makerPubkey = callerKeypair.publicKey; // in real use, this comes from the user
    const mintAPubkey = new PublicKey("MINT_A_ADDRESS_HERE");
    const seed = new BN(42); // same seed used when creating the escrow

    // Expire in 24 hours (86400 seconds)
    const expiryTimestamp = Math.floor(Date.now() / 1000) + 86400;

    await scheduleEscrowRefund({
        callerKeypair,
        makerPubkey,
        mintAPubkey,
        seed,
        expiryTimestamp,
    });
}

main().catch(console.error);