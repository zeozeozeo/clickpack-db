package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/disgoorg/disgo"
	"github.com/disgoorg/disgo/bot"
	"github.com/disgoorg/disgo/gateway"
	"github.com/disgoorg/disgo/handler"
	"github.com/joho/godotenv"
	"github.com/zeozeozeo/clickpack-db/bot/commands"
)

func main() {
	slog.SetLogLoggerLevel(slog.LevelDebug)
	err := godotenv.Load()
	if err != nil {
		panic(err)
	}

	r := handler.New()
	if err := commands.RegisterHandlers(r); err != nil {
		slog.Error("error while registering command handlers", slog.Any("err", err))
		return
	}

	client, err := disgo.New(
		os.Getenv("CLICKPACKDB_DISCORD_TOKEN"),
		bot.WithGatewayConfigOpts(
			gateway.WithIntents(
				gateway.IntentGuilds,
				gateway.IntentGuildMessages,
				gateway.IntentMessageContent,
			),
		),
		bot.WithEventManagerConfigOpts(
			bot.WithAsyncEventsEnabled(),
		),
		bot.WithEventListenerFunc(commands.OnMessageCreate),
		bot.WithEventListeners(r),
	)
	if err != nil {
		panic(err)
	}

	if err = client.OpenGateway(context.TODO()); err != nil {
		panic(err)
	}

	slog.Info("bot is running")

	s := make(chan os.Signal, 1)
	signal.Notify(s, syscall.SIGINT, syscall.SIGTERM)
	<-s
}
