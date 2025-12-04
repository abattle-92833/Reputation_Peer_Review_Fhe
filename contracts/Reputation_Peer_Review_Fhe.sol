pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ReputationPeerReviewFhe is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidBatch();
    error InvalidParameter();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error AlreadyInitialized();

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Batch {
        bool isOpen;
        uint256 reviewCount;
        euint32 encryptedSum;
    }

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ReviewSubmitted(address indexed submitter, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 reputationScore);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier submissionRateLimited() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;
        _;
    }

    modifier decryptionRateLimited() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        emit ProviderAdded(owner);
        cooldownSeconds = 60; 
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidParameter();
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batches[currentBatchId].isOpen = true;
        batches[currentBatchId].reviewCount = 0;
        batches[currentBatchId].encryptedSum = FHE.asEuint32(0);
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        batches[currentBatchId].isOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedReview(euint32 encryptedScore) external onlyProvider whenNotPaused submissionRateLimited {
        if (!batches[currentBatchId].isOpen) revert BatchClosed();
        if (!encryptedScore.isInitialized()) revert NotInitialized();
        batches[currentBatchId].encryptedSum = FHE.add(batches[currentBatchId].encryptedSum, encryptedScore);
        batches[currentBatchId].reviewCount++;
        emit ReviewSubmitted(msg.sender, currentBatchId);
    }

    function requestBatchReputationScore() external onlyOwner whenNotPaused decryptionRateLimited {
        if (batches[currentBatchId].isOpen) revert BatchNotClosed();
        if (batches[currentBatchId].reviewCount == 0) revert NoReviews();

        euint32 finalEncryptedScore = batches[currentBatchId].encryptedSum;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(finalEncryptedScore);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({
            batchId: currentBatchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, currentBatchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        if (keccak256(abi.encodePacked(cleartexts)) == keccak256(abi.encodePacked(new bytes(0)))) revert EmptyCleartexts();

        euint32 finalEncryptedScore = batches[decryptionContexts[requestId].batchId].encryptedSum;
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(finalEncryptedScore);

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        uint32 reputationScore = abi.decode(cleartexts, (uint32));
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, reputationScore);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _requireInitialized(euint32 val) internal pure {
        if (!val.isInitialized()) revert NotInitialized();
    }

    function _requireInitialized(ebool val) internal pure {
        if (!val.isInitialized()) revert NotInitialized();
    }
}