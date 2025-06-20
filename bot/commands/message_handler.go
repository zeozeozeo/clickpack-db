package commands

import (
	"slices"
	"strings"

	"github.com/disgoorg/disgo/events"
	"github.com/disgoorg/snowflake/v2"
)

var clickpackChannelIDs = []snowflake.ID{952187055092416582, 1383785285074292848}

//const clickpackChannelID = 783959799347019817
//const modChannelID = 908268938482286634

func OnMessageCreate(event *events.MessageCreate) {
	if !slices.Contains(clickpackChannelIDs, event.ChannelID) {
		return
	}

	for i, attachment := range event.Message.Attachments {
		if attachment.URL == "" {
			continue
		}
		for _, ext := range archiveExtensions {
			if len(attachment.Filename) > len(ext) && attachment.Filename[len(attachment.Filename)-len(ext):] == ext {
				SendVerify(event.Client(), event.Message, strings.ReplaceAll(attachment.Filename, "_", " "), i)
			}
		}
	}
}
