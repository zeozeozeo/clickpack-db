package commands

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

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

const announceChannelID = 1383790392008249384

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

	// download and process the attachment
	err = processApprovedClickpack(attachment, name, *triggerMessage)
	if err != nil {
		slog.Error("failed to process clickpack", "err", err, "name", name)
		// show error
		event.Client().Rest().UpdateMessage(
			event.Channel().ID(),
			event.Message.ID,
			discord.NewMessageUpdateBuilder().
				SetEmbeds(
					discord.NewEmbedBuilder().
						SetTitlef("New clickpack `%s` (error)", name).
						SetDescriptionf(
							"Failed to process clickpack: %s\nApproved by %s. Jump to the original message: %s",
							err.Error(), event.User().Mention(), triggerMessage.JumpURL(),
						).
						SetColor(0xFF0000).
						Build(),
				).
				ClearContainerComponents().
				Build(),
		)
		return err
	}

	// show success
	_, err = event.Client().Rest().UpdateMessage(
		event.Channel().ID(),
		event.Message.ID,
		discord.NewMessageUpdateBuilder().
			SetEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s` (approved)", name).
					SetDescriptionf(
						"This clickpack has been approved by %s. Jump to the original message: %s",
						event.User().Mention(), triggerMessage.JumpURL(),
					).
					SetColor(0x00FF00).
					Build(),
			).
			ClearContainerComponents().
			Build(),
	)
	if err != nil {
		slog.Error("failed to update message", "err", err)
	}

	_, err = event.Client().Rest().CreateMessage(
		announceChannelID,
		discord.NewMessageCreateBuilder().
			AddEmbeds(
				discord.NewEmbedBuilder().
					SetTitlef("New clickpack `%s`", name).
					SetDescriptionf(
						"This clickpack has been approved by %s. Jump to the original message: %s",
						event.User().Mention(), triggerMessage.JumpURL(),
					).
					SetAuthor(event.User().EffectiveName(), "", event.User().EffectiveAvatarURL()).
					SetColor(0x007BFF).
					Build(),
			).
			Build(),
	)
	if err != nil {
		slog.Error("failed to send announcement", "err", err)
	}

	return nil
}

func processApprovedClickpack(attachment discord.Attachment, name string, triggerMessage discord.Message) error {
	// create db directory if it doesn't exist
	dbDir := "../db"
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

	// change to parent directory to run scripts
	originalDir, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("failed to get working directory: %w", err)
	}

	parentDir := filepath.Join(originalDir, "..")
	if err := os.Chdir(parentDir); err != nil {
		return fmt.Errorf("failed to change to parent directory: %w", err)
	}
	defer os.Chdir(originalDir)

	// run audio2ogg.py
	pythonCmd := os.Getenv("PYTHON_COMMAND")
	slog.Info("running audio2ogg.py...")
	cmd := exec.Command(pythonCmd, "audio2ogg.py")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run audio2ogg.py: %w", err)
	}

	// run index.py
	slog.Info("running index.py...")
	cmd = exec.Command(pythonCmd, "index.py")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run index.py: %w", err)
	}

	// git operations
	if err := gitCommitAndPush(name, triggerMessage); err != nil {
		return fmt.Errorf("failed to commit and push: %w", err)
	}

	return nil
}

func gitCommitAndPush(clickpackName string, triggerMessage discord.Message) error {
	// configure git user (use environment variables)
	gitUserName := os.Getenv("GIT_USER_NAME")
	gitUserEmail := os.Getenv("GIT_USER_EMAIL")
	githubToken := os.Getenv("GITHUB_TOKEN")

	if gitUserName != "" {
		cmd := exec.Command("git", "config", "user.name", gitUserName)
		if err := cmd.Run(); err != nil {
			slog.Warn("failed to set git user.name", "err", err)
		}
	}

	if gitUserEmail != "" {
		cmd := exec.Command("git", "config", "user.email", gitUserEmail)
		if err := cmd.Run(); err != nil {
			slog.Warn("failed to set git user.email", "err", err)
		}
	}

	// configure git to use token for authentication if available
	if githubToken != "" {
		// get current remote URL
		cmd := exec.Command("git", "remote", "get-url", "origin")
		output, err := cmd.Output()
		if err != nil {
			slog.Warn("failed to get remote URL", "err", err)
		} else {
			remoteURL := strings.TrimSpace(string(output))

			// if it's an HTTPS URL, configure it to use the token
			if strings.HasPrefix(remoteURL, "https://github.com/") {
				// extract the repo path (owner/repo.git)
				repoPath := strings.TrimPrefix(remoteURL, "https://github.com/")
				authenticatedURL := fmt.Sprintf("https://%s@github.com/%s", githubToken, repoPath)

				// temporarily set the remote URL with token
				cmd = exec.Command("git", "remote", "set-url", "origin", authenticatedURL)
				if err := cmd.Run(); err != nil {
					slog.Warn("failed to set authenticated remote URL", "err", err)
				} else {
					slog.Debug("configured git remote with token authentication")
					// restore original URL after push (defer)
					defer func() {
						cmd := exec.Command("git", "remote", "set-url", "origin", remoteURL)
						if err := cmd.Run(); err != nil {
							slog.Warn("failed to restore original remote URL", "err", err)
						}
					}()
				}
			}
		}
	}

	// add all changes
	cmd := exec.Command("git", "add", ".")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to git add: %w", err)
	}

	// create commit message with author info
	commitMsg := fmt.Sprintf("Add clickpack: %s\n\nSubmitted by: %s (%s)\nMessage: %s",
		clickpackName,
		triggerMessage.Author.EffectiveName(),
		triggerMessage.Author.ID,
		triggerMessage.JumpURL(),
	)

	// commit changes
	cmd = exec.Command("git", "commit", "-m", commitMsg)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to git commit: %w", err)
	}

	// push to remote
	cmd = exec.Command("git", "push")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to git push: %w", err)
	}

	slog.Info("successfully committed and pushed clickpack", "name", clickpackName)
	return nil
}
