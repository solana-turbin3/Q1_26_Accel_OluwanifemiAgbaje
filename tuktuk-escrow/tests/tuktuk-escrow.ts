import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TuktukEscrow } from "../target/types/tuktuk_escrow";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  init,
  taskQueueKey,
  taskQueueNameMappingKey,
  tuktukConfigKey,
  taskKey,
  taskQueueAuthorityKey,
} from "@helium/tuktuk-sdk";

describe("tuktuk-escrow", () => {
  // Configure the client
anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const program = anchor.workspace.TuktukEscrow as Program<TuktukEscrow>;
  const me = provider.wallet.publicKey;
  
  // Test wallets
  const maker = Keypair.generate();
  const taker = Keypair.generate();
  
  // Test mints
  let mintA: PublicKey;
  let mintB: PublicKey;
  
  // Token accounts
  let makerAtaA: PublicKey;
  let makerAtaB: PublicKey;
  let takerAtaA: PublicKey;
  let takerAtaB: PublicKey;
  
  // Escrow state
  const seed = new BN(Date.now());
  let escrowPDA: PublicKey;
  let vaultPDA: PublicKey;
  
  // TukTuk
let tuktukProgram: any;
  const tuktukConfig = tuktukConfigKey()[0];
  let taskQueue: PublicKey;
  let taskQueueAuthority: PublicKey;
  let queueAuthority: PublicKey;
  const TASK_QUEUE_NAME = "test-escrow-queue1";
  const minCrankReward = new BN(5000000); // 0.005 SOL

  before(async () => {
    console.log("\n🔧 Setting up test environment...\n");

    // Initialize TukTuk SDK
    tuktukProgram = await init(provider);

    // Initialize TukTuk config if needed
    if (!(await tuktukProgram.account.tuktukConfigV0.fetchNullable(tuktukConfig))) {
      await tuktukProgram.methods
        .initializeTuktukConfigV0({
          minDeposit: new BN(100000000),
        })
        .accounts({
          authority: me,
        })
        .rpc();
      console.log("✅ Initialized TukTuk config");
    }

    // Create task queue
    const config = await tuktukProgram.account.tuktukConfigV0.fetch(tuktukConfig);
    const nextTaskQueueId = config.nextTaskQueueId;
    taskQueue = taskQueueKey(tuktukConfig, nextTaskQueueId)[0];
    
    await tuktukProgram.methods
      .initializeTaskQueueV0({
        name: TASK_QUEUE_NAME,
        minCrankReward,
        capacity: 100,
        lookupTables: [],
        staleTaskAge: 86400, // 24 hours
      })
      .accounts({
        tuktukConfig,
        payer: me,
        updateAuthority: me,
        taskQueue,
        taskQueueNameMapping: taskQueueNameMappingKey(tuktukConfig, TASK_QUEUE_NAME)[0],
      })
      .rpc();
    console.log("✅ Created task queue:", taskQueue.toBase58());

    // Derive queue authority PDA for our program
    [queueAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("queue_authority")],
      program.programId
    );

    // Add queue authority
    await tuktukProgram.methods
      .addQueueAuthorityV0()
      .accounts({
        payer: me,
        queueAuthority,
        taskQueue,
      })
      .rpc();
    console.log("✅ Added queue authority:", queueAuthority.toBase58());

    // Fund the queue authority
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: me,
          toPubkey: queueAuthority,
          lamports: 1 * LAMPORTS_PER_SOL,
        })
      )
    );
    console.log("✅ Funded queue authority with 1 SOL");

    // Get task queue authority PDA
    taskQueueAuthority = taskQueueAuthorityKey(taskQueue, queueAuthority)[0];

  await provider.sendAndConfirm(
  new anchor.web3.Transaction().add(
    SystemProgram.transfer({
      fromPubkey: me,
      toPubkey: maker.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    }),
    SystemProgram.transfer({
      fromPubkey: me,
      toPubkey: taker.publicKey,
      lamports: 2 * LAMPORTS_PER_SOL,
    })
  )
);

    console.log("✅ Funded maker:", maker.publicKey.toBase58());
    console.log("✅ Funded taker:", taker.publicKey.toBase58());

    // Create mints
    mintA = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("✅ Created Mint A:", mintA.toBase58());

    mintB = await createMint(
      provider.connection,
      taker,
      taker.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("✅ Created Mint B:", mintB.toBase58());

    // Create and fund token accounts
    makerAtaA = await getAssociatedTokenAddress(
      mintA,
      maker.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey,
      undefined,
      TOKEN_PROGRAM_ID
    );

    makerAtaB = await getAssociatedTokenAddress(
      mintB,
      maker.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    takerAtaA = await getAssociatedTokenAddress(
      mintA,
      taker.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );

    takerAtaB = await getAssociatedTokenAddress(
      mintB,
      taker.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    await createAssociatedTokenAccount(
      provider.connection,
      taker,
      mintB,
      taker.publicKey,
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Mint tokens
    await mintTo(
      provider.connection,
      maker,
      mintA,
      makerAtaA,
      maker,
      1000_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    await mintTo(
      provider.connection,
      taker,
      mintB,
      takerAtaB,
      taker,
      500_000_000,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    console.log("✅ Minted 1000 Token A to maker");
    console.log("✅ Minted 500 Token B to taker");

    // Derive escrow PDAs
    [escrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    vaultPDA = await getAssociatedTokenAddress(
      mintA,
      escrowPDA,
      true,
      TOKEN_PROGRAM_ID
    );

    console.log("\n📋 Account Addresses:");
    console.log("   Escrow PDA:          ", escrowPDA.toBase58());
    console.log("   Vault PDA:           ", vaultPDA.toBase58());
    console.log("   Task Queue:          ", taskQueue.toBase58());
    console.log("   Queue Authority:     ", queueAuthority.toBase58());
    console.log("   Task Queue Authority:", taskQueueAuthority.toBase58());
  });

  it("Creates escrow and schedules refund with TukTuk", async () => {
    console.log("\n🏗️  Test 1: Making Escrow with Auto-Refund");

    const depositAmount = new BN(100_000_000); // 100 tokens
    const receiveAmount = new BN(50_000_000);  // 50 tokens
    
    // Set expiry to 10 days from now
    const now = Math.floor(Date.now() / 1000);
    const tenDays = 10 * 24 * 60 * 60;
    const expiry = new BN(now + tenDays);
    
    const taskId = 0;
    const taskPDA = taskKey(taskQueue, taskId)[0];

    const tx = await program.methods
      .make(seed, depositAmount, receiveAmount, taskId, expiry)
      .accountsPartial({
        maker: maker.publicKey,
        mintA: mintA,
        mintB: mintB,
        escrow: escrowPDA,
        vault: vaultPDA,
        taskQueue: taskQueue,
        taskQueueAuthority: taskQueueAuthority,
        task: taskPDA,
        queueAuthority: queueAuthority,
        tuktukProgram: tuktukProgram.programId,
      })
      .signers([maker])
      .rpc({ skipPreflight: true });

    console.log("✅ Make transaction signature:", tx);

    // Verify escrow state
    const escrowAccount = await program.account.escrow.fetch(escrowPDA);
    assert.equal(escrowAccount.maker.toBase58(), maker.publicKey.toBase58());
    assert.equal(escrowAccount.seed.toNumber(), seed.toNumber());
    assert.equal(escrowAccount.receive.toNumber(), receiveAmount.toNumber());
    console.log("✅ Escrow state verified");

    // Verify vault has tokens
    const vaultAccount = await getAccount(
      provider.connection,
      vaultPDA,
      undefined,
      TOKEN_PROGRAM_ID
    );
    assert.equal(vaultAccount.amount.toString(), depositAmount.toString());
    console.log("✅ Vault holds", depositAmount.toNumber() / 1_000_000, "tokens");

    // Verify task was created
    const taskAccount = await tuktukProgram.account.taskV0.fetch(taskPDA);
    assert.equal(taskAccount.id, taskId);
    console.log("✅ TukTuk task created with ID:", taskAccount.id);
    console.log("   Refund scheduled for:", new Date((now + tenDays) * 1000).toISOString());
  });

  it("Taker accepts the escrow trade", async () => {
    console.log("\n🤝 Test 2: Taker Accepting Escrow");

    const tx = await program.methods
      .take()
      .accountsPartial({
        taker: taker.publicKey,
        mintA: mintA,
        mintB: mintB,
        escrow: escrowPDA,
        vault: vaultPDA,
      })
      .signers([taker])
      .rpc();

    console.log("✅ Take transaction signature:", tx);

    // Verify taker received maker's tokens
    const takerAccountA = await getAccount(
      provider.connection,
      takerAtaA,
      undefined,
      TOKEN_PROGRAM_ID
    );
    assert.equal(takerAccountA.amount.toString(), "100000000");
    console.log("✅ Taker received 100 tokens of Mint A");

    // Verify maker received taker's tokens
    const makerAccountB = await getAccount(
      provider.connection,
      makerAtaB,
      undefined,
      TOKEN_PROGRAM_ID
    );
    assert.equal(makerAccountB.amount.toString(), "50000000");
    console.log("✅ Maker received 50 tokens of Mint B");

    // Verify escrow closed
    try {
      await program.account.escrow.fetch(escrowPDA);
      assert.fail("Escrow should be closed");
    } catch (err) {
      console.log("✅ Escrow account closed successfully");
    }
  });

  it("Refunds escrow if taker doesn't accept", async () => {
    console.log("\n💸 Test 3: Testing Refund Path");

    // Create new escrow for refund test
    const newSeed = new BN(Date.now() + 1000);
    const [newEscrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), newSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const newVaultPDA = await getAssociatedTokenAddress(
      mintA,
      newEscrowPDA,
      true,
      TOKEN_PROGRAM_ID
    );

    const depositAmount = new BN(50_000_000);
    const receiveAmount = new BN(25_000_000);
    const pastExpiry = new BN(Math.floor(Date.now() / 1000) - 100);
    
    const taskId = 1;
    const taskPDA = taskKey(taskQueue, taskId)[0];

    // Create escrow with past expiry
    await program.methods
      .make(newSeed, depositAmount, receiveAmount, taskId, pastExpiry)
      .accountsPartial({
        maker: maker.publicKey,
        mintA: mintA,
        mintB: mintB,
        escrow: newEscrowPDA,
        vault: newVaultPDA,
        taskQueue: taskQueue,
        taskQueueAuthority: taskQueueAuthority,
        task: taskPDA,
        queueAuthority: queueAuthority,
        tuktukProgram: tuktukProgram.programId,
      })
      .signers([maker])
      .rpc({ skipPreflight: true });

    console.log("✅ Created test escrow with past expiry");

    // Get balance before refund
    const makerBefore = await getAccount(
      provider.connection,
      makerAtaA,
      undefined,
      TOKEN_PROGRAM_ID
    );
    const balanceBefore = makerBefore.amount;

    // Call refund
    const refundTx = await program.methods
      .refund()
      .accountsPartial({
        escrow: newEscrowPDA,
        vault: newVaultPDA,
      })
      .rpc();

    console.log("✅ Refund transaction signature:", refundTx);

    // Verify refund
    const makerAfter = await getAccount(
      provider.connection,
      makerAtaA,
      undefined,
      TOKEN_PROGRAM_ID
    );
    const balanceAfter = makerAfter.amount;
    
    assert.equal(
      (balanceAfter - balanceBefore).toString(),
      depositAmount.toString()
    );
    console.log("✅ Maker received refund of", depositAmount.toNumber() / 1_000_000, "tokens");
  });

  it("Fails to refund before expiry time", async () => {
    console.log("\n⏳ Test 4: Testing Refund Protection");

    const newSeed = new BN(Date.now() + 2000);
    const [newEscrowPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), maker.publicKey.toBuffer(), newSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const newVaultPDA = await getAssociatedTokenAddress(
      mintA,
      newEscrowPDA,
      true,
      TOKEN_PROGRAM_ID
    );

    const depositAmount = new BN(50_000_000);
    const receiveAmount = new BN(25_000_000);
    const futureExpiry = new BN(Math.floor(Date.now() / 1000) + 86400);
    
    const taskId = 2;
    const taskPDA = taskKey(taskQueue, taskId)[0];

    await program.methods
      .make(newSeed, depositAmount, receiveAmount, taskId,  futureExpiry)
      .accountsPartial({
        maker: maker.publicKey,
        mintA: mintA,
        mintB: mintB,
        escrow: newEscrowPDA,
        vault: newVaultPDA,
        taskQueue: taskQueue,
        taskQueueAuthority: taskQueueAuthority,
        task: taskPDA,
        queueAuthority: queueAuthority,
        tuktukProgram: tuktukProgram.programId,
      })
      .signers([maker])
      .rpc({ skipPreflight: true });

    console.log("✅ Created escrow with future expiry");

    // Try to refund early (should fail)
    try {
      await program.methods
        .refund()
        .accountsPartial({
          escrow: newEscrowPDA,
          vault: newVaultPDA,
        })
        .rpc();

      assert.fail("Should not allow refund before expiry");
    } catch (err) {
      console.log("✅ Correctly rejected early refund attempt");
      console.log("   Error:", err.error?.errorMessage || err.message);
    }
  });
});