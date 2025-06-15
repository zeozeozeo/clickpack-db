package commands

import (
	"log/slog"

	"github.com/disgoorg/disgo/events"
)

const clickpackChannelID = 952187055092416582
const modChannelID = 1383734997181005885

//const clickpackChannelID = 783959799347019817
//const modChannelID = 908268938482286634

func OnMessageCreate(event *events.MessageCreate) {
	if event.ChannelID != clickpackChannelID {
		return
	}

	slog.Info("good", "attachments", len(event.Message.Attachments), "content", event.Message.Content, "author", event.Message.Author.EffectiveName(), "id", event.Message.ID)

	for _, attachment := range event.Message.Attachments {
		slog.Info("attachment", "filename", attachment.Filename, "url", attachment.URL)
		if attachment.URL == "" {
			continue
		}
		for i, ext := range archiveExtensions {
			slog.Info("checking attachment", "filename", attachment.Filename, "ext", ext, "dbg", attachment.Filename[len(attachment.Filename)-len(ext):])
			if len(attachment.Filename) > len(ext) && attachment.Filename[len(attachment.Filename)-len(ext):] == ext {
				SendVerify(event.Client(), event.Message, attachment.Filename, i)
			}
		}
	}
}
