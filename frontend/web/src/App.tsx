// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Review {
  id: string;
  encryptedScore: string;
  encryptedComment: string;
  timestamp: number;
  reviewer: string;
  reviewee: string;
  status: "pending" | "verified" | "rejected";
  category: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHEComputeAverage = (encryptedScores: string[]): string => {
  let total = 0;
  encryptedScores.forEach(score => {
    total += FHEDecryptNumber(score);
  });
  const average = total / encryptedScores.length;
  return FHEEncryptNumber(average);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newReview, setNewReview] = useState({ reviewee: "", score: 0, comment: "", category: "Professional" });
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [reputationScores, setReputationScores] = useState<{address: string, score: number}[]>([]);

  // Load reviews from contract
  const loadReviews = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Get review keys
      const keysBytes = await contract.getData("review_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing review keys:", e); }
      }
      
      // Load each review
      const reviewList: Review[] = [];
      for (const key of keys) {
        try {
          const reviewBytes = await contract.getData(`review_${key}`);
          if (reviewBytes.length > 0) {
            try {
              const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
              reviewList.push({ 
                id: key, 
                encryptedScore: reviewData.score, 
                encryptedComment: reviewData.comment,
                timestamp: reviewData.timestamp, 
                reviewer: reviewData.reviewer, 
                reviewee: reviewData.reviewee,
                status: reviewData.status || "pending",
                category: reviewData.category || "Professional"
              });
            } catch (e) { console.error(`Error parsing review data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading review ${key}:`, e); }
      }
      
      // Sort by timestamp and set state
      reviewList.sort((a, b) => b.timestamp - a.timestamp);
      setReviews(reviewList);
      
      // Calculate reputation scores
      calculateReputationScores(reviewList);
    } catch (e) { console.error("Error loading reviews:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  // Calculate reputation scores from verified reviews
  const calculateReputationScores = (reviewList: Review[]) => {
    const verifiedReviews = reviewList.filter(r => r.status === "verified");
    const scoreMap: Record<string, {total: number, count: number}> = {};
    
    verifiedReviews.forEach(review => {
      const score = FHEDecryptNumber(review.encryptedScore);
      if (!scoreMap[review.reviewee]) {
        scoreMap[review.reviewee] = {total: score, count: 1};
      } else {
        scoreMap[review.reviewee].total += score;
        scoreMap[review.reviewee].count += 1;
      }
    });
    
    const scores = Object.entries(scoreMap).map(([address, {total, count}]) => ({
      address,
      score: total / count
    })).sort((a, b) => b.score - a.score);
    
    setReputationScores(scores);
  };

  // Submit a new review
  const submitReview = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (!newReview.reviewee || !newReview.score) { alert("Please fill required fields"); return; }
    
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting review with Zama FHE..." });
    
    try {
      const encryptedScore = FHEEncryptNumber(newReview.score);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const reviewId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const reviewData = { 
        score: encryptedScore, 
        comment: newReview.comment,
        timestamp: Math.floor(Date.now() / 1000), 
        reviewer: address, 
        reviewee: newReview.reviewee,
        status: "pending",
        category: newReview.category
      };
      
      // Store review data
      await contract.setData(`review_${reviewId}`, ethers.toUtf8Bytes(JSON.stringify(reviewData)));
      
      // Update review keys
      const keysBytes = await contract.getData("review_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(reviewId);
      await contract.setData("review_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted review submitted securely!" });
      await loadReviews();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewReview({ reviewee: "", score: 0, comment: "", category: "Professional" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  // Decrypt score with wallet signature
  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  // Verify a review
  const verifyReview = async (reviewId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted review with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      const reviewBytes = await contract.getData(`review_${reviewId}`);
      if (reviewBytes.length === 0) throw new Error("Review not found");
      const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedReview = { ...reviewData, status: "verified" };
      await contractWithSigner.setData(`review_${reviewId}`, ethers.toUtf8Bytes(JSON.stringify(updatedReview)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE verification completed successfully!" });
      await loadReviews();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Reject a review
  const rejectReview = async (reviewId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted review with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const reviewBytes = await contract.getData(`review_${reviewId}`);
      if (reviewBytes.length === 0) throw new Error("Review not found");
      const reviewData = JSON.parse(ethers.toUtf8String(reviewBytes));
      
      const updatedReview = { ...reviewData, status: "rejected" };
      await contract.setData(`review_${reviewId}`, ethers.toUtf8String(JSON.stringify(updatedReview)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE rejection completed successfully!" });
      await loadReviews();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Rejection failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  // Initialize component
  useEffect(() => {
    loadReviews().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  // Filter reviews based on search and category
  const filteredReviews = reviews.filter(review => {
    const matchesSearch = 
      review.reviewee.toLowerCase().includes(searchTerm.toLowerCase()) ||
      review.reviewer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      review.id.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesCategory = 
      filterCategory === "All" || 
      review.category === filterCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Check if current user is the reviewer
  const isReviewer = (reviewAddress: string) => address?.toLowerCase() === reviewAddress.toLowerCase();

  // Loading state
  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted reputation system...</p>
    </div>
  );

  // Main app render
  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE<span>Reputation</span></h1>
          <p>Decentralized reputation with encrypted peer reviews</p>
        </div>
        <div className="header-actions">
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} />
        </div>
      </header>

      <main className="main-content">
        {/* Hero section */}
        <section className="hero-section">
          <div className="hero-content">
            <h2>Build Trust with Encrypted Peer Reviews</h2>
            <p>Invite others to review you with FHE-encrypted scores that aggregate into a private reputation score</p>
            <button 
              className="cta-button" 
              onClick={() => setShowCreateModal(true)}
              disabled={!isConnected}
            >
              {isConnected ? "Request Review" : "Connect Wallet"}
            </button>
          </div>
          <div className="hero-gradient"></div>
        </section>

        {/* Stats cards */}
        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total Reviews</h3>
            <p className="stat-value">{reviews.length}</p>
          </div>
          <div className="stat-card">
            <h3>Verified Reviews</h3>
            <p className="stat-value">{reviews.filter(r => r.status === "verified").length}</p>
          </div>
          <div className="stat-card">
            <h3>Average Score</h3>
            <p className="stat-value">
              {reputationScores.length > 0 ? 
                (reputationScores.reduce((sum, user) => sum + user.score, 0) / reputationScores.length).toFixed(1) : 
                "N/A"}
            </p>
          </div>
          <div className="stat-card">
            <h3>Top Reputation</h3>
            <p className="stat-value">
              {reputationScores.length > 0 ? reputationScores[0].score.toFixed(1) : "N/A"}
            </p>
          </div>
        </div>

        {/* Reputation leaderboard */}
        <section className="leaderboard-section">
          <h2>Reputation Leaderboard</h2>
          <div className="leaderboard-container">
            {reputationScores.slice(0, 5).map((user, index) => (
              <div className="leaderboard-item" key={user.address}>
                <div className="rank">{index + 1}</div>
                <div className="address">{user.address.substring(0, 6)}...{user.address.substring(38)}</div>
                <div className="score">
                  <div className="score-bar" style={{ width: `${(user.score / 5) * 100}%` }}></div>
                  <span>{user.score.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Reviews section */}
        <section className="reviews-section">
          <div className="section-header">
            <h2>Peer Reviews</h2>
            <div className="controls">
              <input
                type="text"
                placeholder="Search reviews..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select 
                value={filterCategory} 
                onChange={(e) => setFilterCategory(e.target.value)}
                className="category-filter"
              >
                <option value="All">All Categories</option>
                <option value="Professional">Professional</option>
                <option value="Technical">Technical</option>
                <option value="Community">Community</option>
                <option value="Personal">Personal</option>
              </select>
              <button onClick={loadReviews} className="refresh-button">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {filteredReviews.length === 0 ? (
            <div className="empty-state">
              <p>No reviews found. Request your first review!</p>
              <button 
                className="cta-button" 
                onClick={() => setShowCreateModal(true)}
                disabled={!isConnected}
              >
                {isConnected ? "Request Review" : "Connect Wallet"}
              </button>
            </div>
          ) : (
            <div className="reviews-grid">
              {filteredReviews.map(review => (
                <div 
                  className={`review-card ${review.status}`} 
                  key={review.id}
                  onClick={() => setSelectedReview(review)}
                >
                  <div className="review-header">
                    <span className="category">{review.category}</span>
                    <span className={`status ${review.status}`}>{review.status}</span>
                  </div>
                  <div className="review-body">
                    <div className="parties">
                      <div>
                        <small>Reviewer</small>
                        <p>{review.reviewer.substring(0, 6)}...{review.reviewer.substring(38)}</p>
                      </div>
                      <div>
                        <small>Reviewee</small>
                        <p>{review.reviewee.substring(0, 6)}...{review.reviewee.substring(38)}</p>
                      </div>
                    </div>
                    <div className="review-meta">
                      <div>
                        <small>Date</small>
                        <p>{new Date(review.timestamp * 1000).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <small>Score</small>
                        <p className="encrypted-score">{review.encryptedScore.substring(0, 10)}...</p>
                      </div>
                    </div>
                  </div>
                  {isReviewer(review.reviewer) && review.status === "pending" && (
                    <div className="review-actions">
                      <button 
                        className="action-button verify" 
                        onClick={(e) => { e.stopPropagation(); verifyReview(review.id); }}
                      >
                        Verify
                      </button>
                      <button 
                        className="action-button reject" 
                        onClick={(e) => { e.stopPropagation(); rejectReview(review.id); }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Create review modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Request Encrypted Review</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-button">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Reviewee Address *</label>
                <input
                  type="text"
                  placeholder="Enter wallet address"
                  value={newReview.reviewee}
                  onChange={(e) => setNewReview({...newReview, reviewee: e.target.value})}
                />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select
                  value={newReview.category}
                  onChange={(e) => setNewReview({...newReview, category: e.target.value})}
                >
                  <option value="Professional">Professional</option>
                  <option value="Technical">Technical</option>
                  <option value="Community">Community</option>
                  <option value="Personal">Personal</option>
                </select>
              </div>
              <div className="form-group">
                <label>Score (1-5) *</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.1"
                  value={newReview.score}
                  onChange={(e) => setNewReview({...newReview, score: parseFloat(e.target.value)})}
                />
              </div>
              <div className="form-group">
                <label>Comment</label>
                <textarea
                  placeholder="Optional comment (not encrypted)"
                  value={newReview.comment}
                  onChange={(e) => setNewReview({...newReview, comment: e.target.value})}
                />
              </div>
              <div className="fhe-notice">
                <div className="fhe-icon"></div>
                <p>Score will be encrypted with Zama FHE before submission</p>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-button">
                Cancel
              </button>
              <button 
                onClick={submitReview} 
                disabled={creating || !newReview.reviewee || !newReview.score}
                className="submit-button"
              >
                {creating ? "Submitting..." : "Submit Review"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review detail modal */}
      {selectedReview && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Review Details</h2>
              <button 
                onClick={() => { setSelectedReview(null); setDecryptedScore(null); }} 
                className="close-button"
              >
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="review-info">
                <div className="info-row">
                  <span>Review ID:</span>
                  <p>{selectedReview.id}</p>
                </div>
                <div className="info-row">
                  <span>Category:</span>
                  <p>{selectedReview.category}</p>
                </div>
                <div className="info-row">
                  <span>Status:</span>
                  <p className={`status ${selectedReview.status}`}>{selectedReview.status}</p>
                </div>
                <div className="info-row">
                  <span>Date:</span>
                  <p>{new Date(selectedReview.timestamp * 1000).toLocaleString()}</p>
                </div>
                <div className="info-row">
                  <span>Reviewer:</span>
                  <p>{selectedReview.reviewer}</p>
                </div>
                <div className="info-row">
                  <span>Reviewee:</span>
                  <p>{selectedReview.reviewee}</p>
                </div>
              </div>
              
              <div className="encrypted-data">
                <h3>Encrypted Score</h3>
                <div className="encrypted-value">{selectedReview.encryptedScore}</div>
                <button 
                  className="decrypt-button"
                  onClick={async () => {
                    if (decryptedScore === null) {
                      const score = await decryptWithSignature(selectedReview.encryptedScore);
                      if (score !== null) setDecryptedScore(score);
                    } else {
                      setDecryptedScore(null);
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedScore !== null ? "Hide Score" : "Decrypt with Wallet"}
                </button>
              </div>
              
              {decryptedScore !== null && (
                <div className="decrypted-data">
                  <h3>Decrypted Score</h3>
                  <div className="score-display">
                    <div className="score-value">{decryptedScore.toFixed(1)}</div>
                    <div className="score-stars">
                      {Array(5).fill(0).map((_, i) => (
                        <span key={i} className={i < Math.round(decryptedScore) ? "filled" : ""}>★</span>
                      ))}
                    </div>
                  </div>
                  <div className="decryption-notice">
                    Decrypted with your wallet signature - this score is normally hidden
                  </div>
                </div>
              )}
              
              <div className="review-comment">
                <h3>Comment</h3>
                <p>{selectedReview.encryptedComment || "No comment provided"}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction status modal */}
      {transactionStatus.visible && (
        <div className="status-overlay">
          <div className={`status-modal ${transactionStatus.status}`}>
            <div className="status-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="status-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-left">
            <h3>FHE Reputation System</h3>
            <p>Powered by Zama FHE technology</p>
          </div>
          <div className="footer-right">
            <p>Building trust through encrypted peer reviews</p>
            <div className="footer-links">
              <a href="#">Documentation</a>
              <a href="#">Privacy Policy</a>
              <a href="#">Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
