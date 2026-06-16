package commands

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/disgoorg/disgo/bot"
	"github.com/disgoorg/disgo/discord"
	"github.com/disgoorg/disgo/handler"
	"github.com/disgoorg/snowflake/v2"
)

var archiveExtensions = []string{
	".zip",
	".7z",
	".rar",
	".tar",
	".gz",
	".bz2",
}

const (
	modChannelID      snowflake.ID = 1383734997181005885
	announceChannelID snowflake.ID = 1383790392008249384
)

var approvalMentionRe = regexp.MustCompile(`Approved by (<@!?\d+>)\.`)

func SendVerify(client bot.Client, msg discord.Message, filename string, attachmentIdx int) {
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	buttonID := fmt.Sprintf("%d|%d:%d*%s", msg.ID, msg.ChannelID, attachmentIdx, name)

	_, err := client.Rest().CreateMessage(modChannelID,
		discord.NewMessageCreateBuilder().
			AddEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s`", name).
					SetDescriptionf(
						"Posted by %s in channel <#%d>: %s\nApprove this clickpack to be added to the database?",
						msg.Author.Mention(), msg.ChannelID, msg.JumpURL(),
					).
					SetColor(0x007BFF).
					SetAuthor(msg.Author.EffectiveName(), "", msg.Author.EffectiveAvatarURL()).
					Build(),
			).
			AddContainerComponents(
				discord.NewActionRow(
					discord.ButtonComponent{
						Style: discord.ButtonStyleSuccess,
						Label: "Approve",
						Emoji: &discord.ComponentEmoji{
							Name: "✅",
						},
						CustomID: "/approve/" + buttonID,
					},
					discord.ButtonComponent{
						Style:    discord.ButtonStyleDanger,
						Label:    "Reject",
						CustomID: "/reject/" + buttonID,
					},
				),
			).
			Build(),
	)

	if err != nil {
		slog.Error("failed to send verify message", "err", err, "triggerID", msg.ID)
	}
}

func extractCustomID(id string) (snowflake.ID, snowflake.ID, int, string, bool) {
	id, part1, ok := strings.Cut(id, "|")
	if !ok {
		return 0, 0, 0, "", false
	}
	channelID, part2, ok := strings.Cut(part1, ":")
	if !ok {
		return 0, 0, 0, "", false
	}
	attachmentIdx, name, ok := strings.Cut(part2, "*")
	if !ok {
		return 0, 0, 0, "", false
	}
	idu, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		return 0, 0, 0, "", false
	}
	channelIDu, err := strconv.ParseUint(channelID, 10, 64)
	if err != nil {
		return 0, 0, 0, "", false
	}
	idx, err := strconv.Atoi(attachmentIdx)
	if err != nil {
		return 0, 0, 0, "", false
	}
	return snowflake.ID(idu), snowflake.ID(channelIDu), idx, name, true
}

func HandleReject(data discord.ButtonInteractionData, event *handler.ComponentEvent) error {
	_, customID, ok := strings.Cut(data.CustomID()[1:], "/")
	slog.Debug("HandleReject", slog.String("id", customID), slog.String("customID", data.CustomID()))
	if !ok {
		slog.Warn("HandleReject: invalid custom id", slog.String("customID", data.CustomID()))
		return fmt.Errorf("invalid custom id: %s", data.CustomID())
	}

	triggerMessageID, channelID, _, name, ok := extractCustomID(customID)
	if !ok {
		slog.Warn("HandleReject: invalid custom id", slog.String("customID", data.CustomID()))
		return fmt.Errorf("invalid custom id: %s", data.CustomID())
	}

	triggerMessage, err := event.Client().Rest().GetMessage(channelID, triggerMessageID)
	if err != nil {
		return err
	}

	event.UpdateMessage(
		discord.NewMessageUpdateBuilder().
			SetEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s` (rejected)", name).
					SetDescriptionf(
						"This clickpack has been rejected by %s. Jump to the original message: %s",
						event.User().Mention(), triggerMessage.JumpURL(),
					).
					SetColor(0xFF0000).
					Build(),
			).
			ClearContainerComponents().
			Build(),
	)

	return nil
}

func HandleApprove(data discord.ButtonInteractionData, event *handler.ComponentEvent) error {
	_, customID, ok := strings.Cut(data.CustomID()[1:], "/")
	slog.Debug("HandleApprove", slog.String("id", customID), slog.String("customID", data.CustomID()))
	if !ok {
		slog.Warn("HandleApprove: invalid custom id", slog.String("customID", data.CustomID()))
		return fmt.Errorf("invalid custom id: %s", data.CustomID())
	}

	triggerMessageID, channelID, attachmentIdx, name, ok := extractCustomID(customID)
	if !ok {
		slog.Warn("HandleApprove: invalid custom id", slog.String("customID", data.CustomID()))
		return fmt.Errorf("invalid custom id: %s", data.CustomID())
	}

	// get the original message with the attachment
	triggerMessage, err := event.Client().Rest().GetMessage(channelID, triggerMessageID)
	if err != nil {
		return fmt.Errorf("failed to get trigger message: %w", err)
	}

	// check if the attachment index is valid
	if attachmentIdx >= len(triggerMessage.Attachments) {
		return fmt.Errorf("invalid attachment index: %d", attachmentIdx)
	}

	attachment := triggerMessage.Attachments[attachmentIdx]

	// defer the response to avoid timeout
	err = event.DeferUpdateMessage()
	if err != nil {
		slog.Error("failed to defer update", "err", err)
	}

	if !enqueueApproval(approvalJob{
		Client:            event.Client(),
		ApprovalChannelID: event.Channel().ID(),
		ApprovalMessageID: event.Message.ID,
		ApproverMention:   event.User().Mention(),
		ApproverName:      event.User().EffectiveName(),
		ApproverAvatarURL: event.User().EffectiveAvatarURL(),
		CustomID:          customID,
		Attachment:        attachment,
		Name:              name,
		TriggerMessage:    *triggerMessage,
	}) {
		return nil
	}

	_, err = event.Client().Rest().UpdateMessage(
		event.Channel().ID(),
		event.Message.ID,
		discord.NewMessageUpdateBuilder().
			SetEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s` (queued)", name).
					SetDescriptionf(
						"This clickpack has been queued for approval by %s. Jump to the original message: %s",
						event.User().Mention(), triggerMessage.JumpURL(),
					).
					SetColor(0xF1C40F).
					Build(),
			).
			ClearContainerComponents().
			Build(),
	)
	if err != nil {
		slog.Error("failed to update message", "err", err)
	}

	return nil
}

func HandleRetry(data discord.ButtonInteractionData, event *handler.ComponentEvent) error {
	slog.Debug("HandleRetry", slog.String("customID", data.CustomID()))

	job, err := retryJobFromMessage(event)
	if err != nil {
		return err
	}

	if err := event.DeferUpdateMessage(); err != nil {
		slog.Error("failed to defer retry update", "err", err)
	}

	if !enqueueApproval(job) {
		return nil
	}

	_, err = event.Client().Rest().UpdateMessage(
		event.Channel().ID(),
		event.Message.ID,
		discord.NewMessageUpdateBuilder().
			SetEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s` (queued)", job.Name).
					SetDescriptionf(
						"This clickpack has been queued for retry. Approved by %s. Jump to the original message: %s",
						job.ApproverMention, job.TriggerMessage.JumpURL(),
					).
					SetColor(0xF1C40F).
					Build(),
			).
			ClearContainerComponents().
			Build(),
	)
	if err != nil {
		slog.Error("failed to update retry message", "err", err)
	}

	return nil
}

func retryJobFromMessage(event *handler.ComponentEvent) (approvalJob, error) {
	if len(event.Message.Embeds) == 0 {
		return approvalJob{}, fmt.Errorf("retry message has no embed")
	}
	embed := event.Message.Embeds[0]
	name, ok := clickpackNameFromEmbedTitle(embed.Title)
	if !ok {
		return approvalJob{}, fmt.Errorf("failed to parse clickpack name from retry message title")
	}
	refs := referencedClickpackMessages(event.Message)
	if len(refs) == 0 {
		return approvalJob{}, fmt.Errorf("failed to find original clickpack message")
	}

	var triggerMessage *discord.Message
	var channelID snowflake.ID
	var messageID snowflake.ID
	for cid, mid := range refs {
		msg, err := event.Client().Rest().GetMessage(cid, mid)
		if err != nil {
			return approvalJob{}, fmt.Errorf("failed to get original clickpack message: %w", err)
		}
		triggerMessage = msg
		channelID = cid
		messageID = mid
		break
	}

	attachmentIdx := matchingAttachmentIndex(*triggerMessage, name)
	if attachmentIdx < 0 {
		return approvalJob{}, fmt.Errorf("failed to find original archive attachment for %q", name)
	}
	attachment := triggerMessage.Attachments[attachmentIdx]
	customID := fmt.Sprintf("%d|%d:%d*%s", messageID, channelID, attachmentIdx, name)

	approverMention := approverMentionFromDescription(embed.Description)
	if approverMention == "" {
		approverMention = event.User().Mention()
	}
	approverName := event.User().EffectiveName()
	approverAvatarURL := event.User().EffectiveAvatarURL()
	if approverID, err := parseMentionID(approverMention); err == nil {
		if user, err := event.Client().Rest().GetUser(approverID); err == nil {
			approverName = user.EffectiveName()
			approverAvatarURL = user.EffectiveAvatarURL()
		}
	}

	return approvalJob{
		Client:            event.Client(),
		ApprovalChannelID: event.Channel().ID(),
		ApprovalMessageID: event.Message.ID,
		ApproverMention:   approverMention,
		ApproverName:      approverName,
		ApproverAvatarURL: approverAvatarURL,
		CustomID:          customID,
		Attachment:        attachment,
		Name:              name,
		TriggerMessage:    *triggerMessage,
	}, nil
}

func clickpackNameFromEmbedTitle(title string) (string, bool) {
	start := strings.Index(title, "`")
	end := strings.LastIndex(title, "`")
	if start < 0 || end <= start {
		return "", false
	}
	return title[start+1 : end], true
}

func matchingAttachmentIndex(msg discord.Message, name string) int {
	for i, attachment := range msg.Attachments {
		normalized := strings.ReplaceAll(attachment.Filename, "_", " ")
		normalized = strings.TrimSuffix(normalized, filepath.Ext(normalized))
		if normalized == name && hasArchiveExtension(attachment.Filename) {
			return i
		}
	}
	for i, attachment := range msg.Attachments {
		if hasArchiveExtension(attachment.Filename) {
			return i
		}
	}
	return -1
}

func hasArchiveExtension(filename string) bool {
	for _, ext := range archiveExtensions {
		if strings.HasSuffix(filename, ext) {
			return true
		}
	}
	return false
}

func approverMentionFromDescription(description string) string {
	match := approvalMentionRe.FindStringSubmatch(description)
	if len(match) != 2 {
		return ""
	}
	return match[1]
}

func parseMentionID(mention string) (snowflake.ID, error) {
	mention = strings.TrimPrefix(mention, "<@")
	mention = strings.TrimPrefix(mention, "!")
	mention = strings.TrimSuffix(mention, ">")
	return parseSnowflake(mention)
}

type approvalJob struct {
	Client            bot.Client
	ApprovalChannelID snowflake.ID
	ApprovalMessageID snowflake.ID
	ApproverMention   string
	ApproverName      string
	ApproverAvatarURL string
	CustomID          string
	Attachment        discord.Attachment
	Name              string
	TriggerMessage    discord.Message
}

var approvals = newApprovalQueue()

type approvalQueue struct {
	mu      sync.Mutex
	pending map[string]struct{}
	jobs    chan approvalJob
}

func newApprovalQueue() *approvalQueue {
	q := &approvalQueue{
		pending: map[string]struct{}{},
		jobs:    make(chan approvalJob, 100),
	}
	go q.run()
	return q
}

func enqueueApproval(job approvalJob) bool {
	return approvals.enqueue(job)
}

func (q *approvalQueue) enqueue(job approvalJob) bool {
	q.mu.Lock()
	if _, ok := q.pending[job.CustomID]; ok {
		q.mu.Unlock()
		slog.Info("approval already queued", "name", job.Name, "customID", job.CustomID)
		return false
	}
	q.pending[job.CustomID] = struct{}{}
	q.mu.Unlock()

	q.jobs <- job
	return true
}

func (q *approvalQueue) complete(job approvalJob) {
	q.mu.Lock()
	delete(q.pending, job.CustomID)
	q.mu.Unlock()
}

func (q *approvalQueue) run() {
	for first := range q.jobs {
		batch := []approvalJob{first}
		timer := time.NewTimer(3 * time.Second)

	collect:
		for {
			select {
			case job := <-q.jobs:
				batch = append(batch, job)
			case <-timer.C:
				break collect
			}
		}

		q.processBatch(batch)
		for _, job := range batch {
			q.complete(job)
		}
	}
}

func (q *approvalQueue) processBatch(batch []approvalJob) {
	restoreRemote, err := gitConfigureAuth()
	if err != nil {
		slog.Warn("failed to configure git auth", "err", err)
	}
	defer restoreRemote()

	if err := gitPullMerge(); err != nil {
		slog.Warn("failed to pull before processing approval batch", "err", err)
	}

	var processed []approvalJob
	for _, job := range batch {
		if err := downloadApprovedClickpack(job.Attachment, job.Name); err != nil {
			slog.Error("failed to download clickpack", "err", err, "name", job.Name)
			updateApprovalError(job, err)
			continue
		}

		if err := runClickpackProcessingScripts(); err != nil {
			slog.Error("failed to process clickpack", "err", err, "name", job.Name)
			updateApprovalError(job, err)
			continue
		}

		if err := gitCommitClickpack(job); err != nil {
			slog.Error("failed to commit clickpack", "err", err, "name", job.Name)
			updateApprovalError(job, err)
			continue
		}

		processed = append(processed, job)
	}

	if len(processed) == 0 {
		return
	}

	if err := gitPushWithMergeRetry(); err != nil {
		slog.Error("failed to push clickpack commits", "err", err)
		for _, job := range processed {
			updateApprovalError(job, err)
		}
		return
	}

	for _, job := range processed {
		updateApprovalSuccess(job)
		sendApprovalAnnouncement(job)
	}
}

func downloadApprovedClickpack(attachment discord.Attachment, name string) error {
	// create db directory if it doesn't exist
	root, err := repoRoot()
	if err != nil {
		return fmt.Errorf("failed to find repo root: %w", err)
	}
	dbDir := filepath.Join(root, "db")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return fmt.Errorf("failed to create db directory: %w", err)
	}

	// download the attachment
	filename := fmt.Sprintf("%s%s", name, filepath.Ext(attachment.Filename))
	filePath := filepath.Join(dbDir, filename)

	resp, err := http.Get(attachment.URL)
	if err != nil {
		return fmt.Errorf("failed to download attachment: %w", err)
	}
	defer resp.Body.Close()

	file, err := os.Create(filePath)
	if err != nil {
		return fmt.Errorf("failed to create file: %w", err)
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	if err != nil {
		return fmt.Errorf("failed to save attachment: %w", err)
	}

	slog.Info("downloaded clickpack", "filename", filename, "path", filePath)
	return nil
}

func runClickpackProcessingScripts() error {
	root, err := repoRoot()
	if err != nil {
		return fmt.Errorf("failed to find repo root: %w", err)
	}

	slog.Info("processing clickpacks in Go")
	return processClickpacks(root)
}

func updateApprovalError(job approvalJob, err error) {
	_, updateErr := job.Client.Rest().UpdateMessage(
		job.ApprovalChannelID,
		job.ApprovalMessageID,
		discord.NewMessageUpdateBuilder().
			SetEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s` (error)", job.Name).
					SetDescriptionf(
						"Failed to process clickpack: %s\nApproved by %s. Jump to the original message: %s",
						err.Error(), job.ApproverMention, job.TriggerMessage.JumpURL(),
					).
					SetColor(0xFF0000).
					Build(),
			).
			SetContainerComponents(
				discord.NewActionRow(
					discord.ButtonComponent{
						Style:    discord.ButtonStylePrimary,
						Label:    "Retry",
						CustomID: "/retry",
					},
				),
			).
			Build(),
	)
	if updateErr != nil {
		slog.Error("failed to update approval error message", "err", updateErr)
	}
}

func updateApprovalSuccess(job approvalJob) {
	_, err := job.Client.Rest().UpdateMessage(
		job.ApprovalChannelID,
		job.ApprovalMessageID,
		discord.NewMessageUpdateBuilder().
			SetEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s` (approved)", job.Name).
					SetDescriptionf(
						"This clickpack has been approved by %s. Jump to the original message: %s",
						job.ApproverMention, job.TriggerMessage.JumpURL(),
					).
					SetColor(0x00FF00).
					Build(),
			).
			ClearContainerComponents().
			Build(),
	)
	if err != nil {
		slog.Error("failed to update approval success message", "err", err)
	}
}

func sendApprovalAnnouncement(job approvalJob) {
	_, err := job.Client.Rest().CreateMessage(
		announceChannelID,
		discord.NewMessageCreateBuilder().
			AddEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s`", job.Name).
					SetDescriptionf(
						"This clickpack has been approved by %s. Jump to the original message: %s",
						job.ApproverMention, job.TriggerMessage.JumpURL(),
					).
					SetAuthor(job.ApproverName, "", job.ApproverAvatarURL).
					SetColor(0x007BFF).
					Build(),
			).
			Build(),
	)
	if err != nil {
		slog.Error("failed to send announcement", "err", err)
	}
}

func gitConfigureAuth() (func(), error) {
	// configure git user (use environment variables)
	gitUserName := os.Getenv("GIT_USER_NAME")
	gitUserEmail := os.Getenv("GIT_USER_EMAIL")
	githubToken := os.Getenv("GITHUB_TOKEN")

	if gitUserName != "" {
		cmd := gitCmd("config", "user.name", gitUserName)
		if err := runGitLogged(cmd); err != nil {
			slog.Warn("failed to set git user.name", "err", err)
		}
	}

	if gitUserEmail != "" {
		cmd := gitCmd("config", "user.email", gitUserEmail)
		if err := runGitLogged(cmd); err != nil {
			slog.Warn("failed to set git user.email", "err", err)
		}
	}

	restoreRemote := func() {}

	// configure git to use token for authentication if available
	if githubToken != "" {
		// get current remote URL
		cmd := gitCmd("remote", "get-url", "origin")
		output, err := cmd.Output()
		if err != nil {
			slog.Warn("failed to get remote URL", "err", err)
		} else {
			remoteURL := strings.TrimSpace(string(output))

			// if it's an HTTPS URL, configure it to use the token
			if strings.HasPrefix(remoteURL, "https://github.com/") {
				// extract the repo path (owner/repo.git)
				repoPath := strings.TrimPrefix(remoteURL, "https://github.com/")
				authenticatedURL := fmt.Sprintf("https://x-access-token:%s@github.com/%s", githubToken, repoPath)

				// temporarily set the remote URL with token
				cmd = gitCmd("remote", "set-url", "origin", authenticatedURL)
				if err := runGitLogged(cmd); err != nil {
					slog.Warn("failed to set authenticated remote URL", "err", err)
				} else {
					slog.Debug("configured git remote with token authentication")
					restoreRemote = func() {
						cmd := gitCmd("remote", "set-url", "origin", remoteURL)
						if err := runGitLogged(cmd); err != nil {
							slog.Warn("failed to restore original remote URL", "err", err)
						}
					}
				}
			}
		}
	}

	return restoreRemote, nil
}

func gitCommitClickpack(job approvalJob) error {
	// add all changes
	cmd := gitCmd("add", ".")
	if err := runGitLogged(cmd); err != nil {
		return fmt.Errorf("failed to git add: %w", err)
	}

	// create commit message with author info
	commitMsg := clickpackCommitMessage(job)

	// commit changes
	cmd = gitCmd("commit", "-m", commitMsg)
	if err := runGitLogged(cmd); err != nil {
		return fmt.Errorf("failed to git commit: %w", err)
	}

	slog.Info("successfully committed clickpack", "name", job.Name)
	return nil
}

func gitPushWithMergeRetry() error {
	// push to remote
	cmd := gitCmd("push")
	if err := runGitLogged(cmd); err != nil {
		slog.Warn("git push failed, trying to merge remote changes before retrying", "err", err)
		if pullErr := gitPullMerge(); pullErr != nil {
			return fmt.Errorf("failed to git push: %w; merge retry failed: %w", err, pullErr)
		}
		cmd = gitCmd("push")
		if retryErr := runGitLogged(cmd); retryErr != nil {
			return fmt.Errorf("failed to git push after merge retry: %w", retryErr)
		}
	}

	slog.Info("successfully pushed clickpack commits")
	return nil
}

func clickpackCommitMessage(job approvalJob) string {
	return fmt.Sprintf("Add clickpack: %s\n\nSubmitted by: %s (%s)\nMessage: %s",
		job.Name,
		job.TriggerMessage.Author.EffectiveName(),
		job.TriggerMessage.Author.ID,
		job.TriggerMessage.JumpURL(),
	)
}

func gitPullMerge() error {
	cmd := gitCmd("pull", "--no-rebase", "--no-edit")
	if err := runGitLogged(cmd); err != nil {
		return fmt.Errorf("failed to git pull --no-rebase --no-edit: %w", err)
	}
	return nil
}

func runGitLogged(cmd *exec.Cmd) error {
	output, err := cmd.CombinedOutput()
	outputText := strings.TrimSpace(redactSecrets(string(output)))
	argsText := redactSecrets(strings.Join(cmd.Args, " "))
	if outputText != "" {
		if err != nil {
			slog.Error("git command failed", "cmd", argsText, "dir", cmd.Dir, "output", outputText, "err", err)
		} else {
			slog.Debug("git command output", "cmd", argsText, "dir", cmd.Dir, "output", outputText)
		}
	} else if err != nil {
		slog.Error("git command failed", "cmd", argsText, "dir", cmd.Dir, "err", err)
	}
	return err
}

func redactSecrets(s string) string {
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		s = strings.ReplaceAll(s, token, "<redacted>")
	}
	return s
}

func gitCmd(args ...string) *exec.Cmd {
	cmd := exec.Command("git", args...)
	if root, err := repoRoot(); err == nil {
		cmd.Dir = root
	}
	return cmd
}

func repoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Dir = wd
	if output, err := cmd.Output(); err == nil {
		return strings.TrimSpace(string(output)), nil
	}

	return filepath.Clean(filepath.Join(wd, "..")), nil
}
