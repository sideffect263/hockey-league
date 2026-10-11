import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Heart, MessageCircle, Send, Loader2, Share2 } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { likeItem, unlikeItem, getItemComments, createItemComment, editItemComment, deleteItemComment } from "@/lib/reactions"
import ModerationMenu from "@/components/feed/ModerationMenu"
import { TARGET_ITEM_COMMENT } from "@/lib/moderation"
import MentionInput from "@/components/feed/MentionInput"
import MentionText, { useMentionViewer, untagItems } from "@/components/feed/MentionText"
import { getMentions, setMentions, removeMention, MENTION_KIND } from "@/lib/mentionsApi"
import { shareTarget } from "@/lib/shareItem"

/**
 * Reusable like + comment bar for SYNTHETIC feed cards (game results,
 * milestones, champion, top-scorer). Same look/behaviour as the human
 * PostCard actions, but backed by feed_item_likes / feed_item_comments,
 * keyed by the feed item's stable `itemKey` (post.id from lib/feed.js).
 * `share` is a lib/shareLinks.js buildShare() target; when given, a share button shows.
 * Comments support @player tags (feed_item_comments → set_mentions 'item_comment').
 */

function CommentAvatar({ url, name, className = "w-8 h-8" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?"
  return url
    ? <img src={url} alt="" className={`${className} rounded-full object-cover shrink-0`} />
    : <div className={`${className} rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold shrink-0`}>{initial}</div>
}

export default function ReactionBar({ itemKey, liked: likedInit = false, likeCount: likeInit = 0, commentCount: commentInit = 0, blockedIds, share }) {
  const { user, openAuth } = useAuth()
  const viewer = useMentionViewer()
  const [mentions, setMentionMap] = useState({})    // item comment id → active tags
  const [newPicks, setNewPicks] = useState([])
  const [editPicks, setEditPicks] = useState([])
  const [tagError, setTagError] = useState(null)

  // Tags are saved after the comment: a failure there never loses the comment.
  const saveTags = async (commentId, text, picks) => {
    try {
      const list = await setMentions(MENTION_KIND.itemComment, commentId, text, picks)
      setMentionMap(m => ({ ...m, [commentId]: list }))
    } catch { setTagError("התגובה נשמרה, אבל התיוג נכשל") }
  }
  const untag = async (m) => {
    try {
      await removeMention(m.id)
      setMentionMap(map => ({ ...map, [m.item_comment_id]: (map[m.item_comment_id] || []).filter(x => x.id !== m.id) }))
    } catch { setTagError("הסרת התיוג נכשלה") }
  }

  const [liked, setLiked] = useState(likedInit)
  const [likeCount, setLikeCount] = useState(likeInit)
  const [commentCount, setCommentCount] = useState(commentInit)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState([])
  const [loadedComments, setLoadedComments] = useState(false)
  const [loadingComments, setLoadingComments] = useState(false)
  const [newComment, setNewComment] = useState("")
  const [posting, setPosting] = useState(false)

  // ---- Moderation (edit / soft-delete) for synthetic-item comments ----
  const [editingCommentId, setEditingCommentId] = useState(null)
  const [commentDraft, setCommentDraft] = useState("")
  const [savingComment, setSavingComment] = useState(false)

  const saveEditComment = async (c) => {
    const text = commentDraft.trim()
    if (!text || savingComment) return
    setSavingComment(true)
    try {
      await editItemComment(c.id, text)
      setComments(cs => cs.map(x => x.id === c.id ? { ...x, body: text } : x))
      setEditingCommentId(null)
      const picks = [...(mentions[c.id] || []), ...editPicks]
      if (picks.length) saveTags(c.id, text, picks)
    } catch { /* keep the editor open on failure */ }
    finally { setSavingComment(false) }
  }
  const handleDeleteComment = async (c) => {
    const prev = comments
    setComments(cs => cs.filter(x => x.id !== c.id))
    setCommentCount(n => Math.max(0, n - 1))
    try { await deleteItemComment(c.id) }
    catch { setComments(prev); setCommentCount(n => n + 1) }
  }

  const visibleComments = comments.filter(c => !blockedIds?.has?.(c.author_id))

  // Feed loads item like/comment counts in a separate pass, so they can arrive
  // after this bar mounts. Sync when the (primitive) initial values resolve;
  // a user's own optimistic toggle doesn't change these props, so it's safe.
  useEffect(() => { setLiked(likedInit) }, [likedInit])
  useEffect(() => { setLikeCount(likeInit) }, [likeInit])
  useEffect(() => { setCommentCount(commentInit) }, [commentInit])

  const toggleLike = async () => {
    if (!user) { openAuth(); return }
    const next = !liked
    setLiked(next); setLikeCount(c => c + (next ? 1 : -1))
    try {
      next ? await likeItem(itemKey) : await unlikeItem(itemKey)
    } catch {
      setLiked(!next); setLikeCount(c => c + (next ? -1 : 1)) // revert
    }
  }

  const toggleComments = async () => {
    const opening = !showComments
    setShowComments(opening)
    if (opening && !loadedComments) {
      setLoadingComments(true)
      try {
        const list = await getItemComments(itemKey)
        setComments(list); setLoadedComments(true)
        getMentions(MENTION_KIND.itemComment, (list || []).map(c => c.id)).then(setMentionMap)
      } catch { /* ignore */ }
      finally { setLoadingComments(false) }
    }
  }

  const submitComment = async (e) => {
    e.preventDefault()
    if (!user) { openAuth(); return }
    const text = newComment.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      const c = await createItemComment(itemKey, text)
      setComments(prev => [...prev, c])
      setCommentCount(n => n + 1)
      setNewComment("")
      const picks = newPicks
      setNewPicks([]); setTagError(null)
      if (picks.length) saveTags(c.id, text, picks)
    } catch { /* ignore */ }
    finally { setPosting(false) }
  }

  return (
    <div data-reactions className="mt-2">
      {/* Actions — the same icon row as PostCard (FeedCardShell), counts on their own line. */}
      <div className="flex items-center gap-4 py-1">
        <button onClick={toggleLike} aria-label={liked ? "ביטול אהבתי" : "אהבתי"}
          className={`transition-colors ${liked ? "text-red-500" : "text-slate-700 dark:text-slate-200 hover:text-red-500"}`}>
          <Heart className={`w-6 h-6 ${liked ? "fill-current" : ""}`} />
        </button>
        <button onClick={toggleComments} aria-label="תגובות" className="text-slate-700 dark:text-slate-200 hover:text-brand transition-colors">
          <MessageCircle className="w-6 h-6" />
        </button>
        {share && (
          <button onClick={() => shareTarget(share)} aria-label="שיתוף" className="ms-auto text-slate-700 dark:text-slate-200 hover:text-brand transition-colors">
            <Share2 className="w-5 h-5" />
          </button>
        )}
      </div>
      {(likeCount > 0 || commentCount > 0) && (
        <p className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-1.5">
          {likeCount > 0 && <span className="font-bold text-slate-900 dark:text-white">{likeCount} אהבו</span>}
          {commentCount > 0 && <>{likeCount > 0 && <span>·</span>}<button onClick={toggleComments} className="hover:text-brand">{commentCount} תגובות</button></>}
        </p>
      )}

      {/* Comments */}
      <AnimatePresence>
        {showComments && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-3 space-y-3">
              {loadingComments ? (
                <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
              ) : (
                <>
                  {visibleComments.map(c => (
                    <div key={c.id} className="flex items-start gap-2.5">
                      <CommentAvatar url={c.author?.avatar_url} name={c.author?.display_name} className="w-8 h-8" />
                      <div className="min-w-0 flex-1 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2">
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{c.author?.display_name || "חבר/ת הליגה"}</p>
                        {editingCommentId === c.id ? (
                          <div className="mt-1">
                            <MentionInput
                              value={commentDraft}
                              onChange={setCommentDraft}
                              onPick={p => setEditPicks(ps => [...ps, p])}
                              maxLength={1000}
                              rows={2}
                              autoFocus
                              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-none"
                            />
                            <div className="flex items-center gap-2 mt-1.5">
                              <button onClick={() => saveEditComment(c)} disabled={savingComment || !commentDraft.trim()}
                                className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
                                {savingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : null} שמירה
                              </button>
                              <button onClick={() => setEditingCommentId(null)} disabled={savingComment}
                                className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                                ביטול
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words"><MentionText text={c.body} mentions={mentions[c.id]} /></p>
                        )}
                      </div>
                      <ModerationMenu
                        targetType={TARGET_ITEM_COMMENT}
                        targetId={c.id}
                        authorId={c.author_id}
                        onEdit={() => { setEditingCommentId(c.id); setCommentDraft(c.body); setEditPicks([]) }}
                        onDelete={() => handleDeleteComment(c)}
                        extraItems={untagItems(mentions[c.id], viewer, untag)}
                      />
                    </div>
                  ))}
                  {visibleComments.length === 0 && <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-1">היו הראשונים להגיב</p>}
                  {tagError && <p className="text-[11px] text-red-500">{tagError}</p>}

                  {user ? (
                    <form onSubmit={submitComment} className="flex items-center gap-2 pt-1">
                      <MentionInput
                        as="input"
                        wrapperClassName="flex-1 min-w-0"
                        value={newComment}
                        onChange={setNewComment}
                        onPick={p => setNewPicks(ps => [...ps, p])}
                        maxLength={1000}
                        placeholder="כתבו תגובה… (@ לתיוג שחקן)"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                      />
                      <button type="submit" disabled={posting || !newComment.trim()} className="shrink-0 w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center disabled:opacity-50">
                        {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      </button>
                    </form>
                  ) : (
                    <button onClick={openAuth} className="text-xs text-brand dark:text-brand-light font-semibold hover:underline pt-1">התחברו כדי להגיב</button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
