# Reputation Peer Review: A Decentralized Encrypted Rating System

Reputation Peer Review is a decentralized reputation system that employs **Zama's Fully Homomorphic Encryption (FHE) technology** to facilitate encrypted peer reviews. Users can invite others to submit FHE-encrypted evaluations and recommendations, ensuring their feedback remains confidential while allowing the system to generate a reliable and attack-resistant reputation score through homomorphic aggregation.

## The Problem Statement

In traditional reputation systems, users often encounter significant challenges such as bias, malicious feedback, and a lack of genuine trust. Public review platforms are rife with issues stemming from "favoritism" and "malicious downvoting." This creates an environment where honest evaluations can be drowned out by insincere actions, often undermining the very framework of trust that these systems aim to build. Consequently, individuals and organizations struggle to establish credible reputations, leading to missed opportunities in professional networks.

## The FHE Solution

Our decentralized reputation system revolutionizes trust by harnessing the power of **Zama's open-source libraries**, including **Concrete**, **TFHE-rs**, and the **zama-fhe SDK**. With FHE technology, we can perform computations on encrypted data without needing to decrypt it, ensuring that each evaluation remains confidential even while contributing to the overall score. This way, users can share their experiences safely and securely, contributing to a more authentic and trustworthy reputation ecosystem.

### How it Works:
1. Users invite peers to submit feedback in the form of encrypted reviews.
2. Using Zama's libraries, the system aggregates these evaluations homomorphically to compute a reputation score.
3. Individual ratings remain private, eliminating bias and malicious intents from impacting a user's overall standing.

## Key Features

- **Peer Review Invitation**: Users can seamlessly invite others to submit encrypted ratings, creating a collaborative evaluation environment.
- **Encrypted Evaluations**: Each review is securely encrypted using FHE, protecting the confidentiality of the feedback.
- **Homomorphic Aggregation**: The platform calculates reputation scores from encrypted reviews, ensuring data privacy is maintained throughout the process.
- **Trust Network Building**: The system aims to establish a more genuine trust network, free from the influences of public review systems.

## Technology Stack

- **Zama's Fully Homomorphic Encryption SDK**: The core technology for implementing encrypted evaluations.
- **Node.js**: A JavaScript runtime for building the backend services.
- **Hardhat/Foundry**: For smart contract development and testing.
- **Solidity**: The programming language used for crafting the contracts.

## Directory Structure

```
Reputation_Peer_Review_Fhe/
├── contracts/
│   └── Reputation_Peer_Review_Fhe.sol
├── scripts/
│   ├── deploy.js
│   └── review.js
├── test/
│   ├── ReputationPeerReview.test.js
└── package.json
```

## Installation Guide

To set up the Reputation Peer Review project, follow these instructions:

1. Ensure you have **Node.js** installed on your machine. You can download it from the official site.
2. Navigate to the project directory in your terminal (where the project files are located).
3. Run the following command to install dependencies:
   ```bash
   npm install
   ```
   This will fetch the necessary Zama FHE libraries required for the project.

**Important**: Do not use `git clone` or any URLs to obtain the project files.

## Build & Run Guide

Once the dependencies are installed, you can compile and deploy the smart contract and run the application as follows:

1. **Compile the smart contracts**:
   ```bash
   npx hardhat compile
   ```

2. **Deploy the contracts**:
   ```bash
   npx hardhat run scripts/deploy.js
   ```

3. **Test the application**:
   ```bash
   npx hardhat test
   ```

### Example Code Snippet

Here's a simple JavaScript function that invites a peer for review:

```javascript
async function invitePeer(reviewerAddress) {
    const reputationContract = await reputationContractInstance();

    try {
        const response = await reputationContract.inviteReviewer(reviewerAddress);
        console.log(`Invitation sent to ${reviewerAddress} with transaction: ${response.transactionHash}`);
    } catch (error) {
        console.error("Error sending invitation:", error);
    }
}
```

This function communicates with the deployed smart contract to invite a peer to submit their review, leveraging the secure infrastructure built with Zama's FHE technology.

## Acknowledgements

This project is made possible through the innovative work of the Zama team. Their pioneering efforts in providing open-source tools for confidential blockchain applications empower developers to create secure and privacy-preserving solutions like the Reputation Peer Review system.
