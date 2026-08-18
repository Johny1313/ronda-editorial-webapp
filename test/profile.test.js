import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeWritingStyle,
  hashPassword,
  normalizeEmail,
  normalizeStyleSample,
  normalizeCarouselLearningExample,
  summarizeCarouselLearning,
  validateEmail,
  validateSlideCount,
  verifyPassword,
  writingStylePrompt,
} from "../src/profile.js";

test("normaliza e valida cadastro por e-mail", () => {
  assert.equal(normalizeEmail("  Editor@EXEMPLO.COM  "), "editor@exemplo.com");
  assert.equal(validateEmail("editor@exemplo.com"), "editor@exemplo.com");
  assert.throws(() => validateEmail("email-invalido"), /e-mail válido/i);
});

test("protege senha com PBKDF2 e valida sem armazenar texto puro", async () => {
  const credentials = await hashPassword("senha-forte-123");
  assert.ok(credentials.hash.length > 30);
  assert.ok(credentials.salt.length > 20);
  assert.equal(await verifyPassword("senha-forte-123", {
    passwordHash: credentials.hash,
    passwordSalt: credentials.salt,
    passwordIterations: credentials.iterations,
  }), true);
  assert.equal(await verifyPassword("senha-errada", {
    passwordHash: credentials.hash,
    passwordSalt: credentials.salt,
    passwordIterations: credentials.iterations,
  }), false);
});

test("quantidade de slides aceita 3 a 15 e mantém 7 como padrão", () => {
  assert.equal(validateSlideCount(undefined), 7);
  assert.equal(validateSlideCount(3), 3);
  assert.equal(validateSlideCount(15), 15);
  assert.throws(() => validateSlideCount(2), /entre 3 e 15/i);
  assert.throws(() => validateSlideCount(16), /entre 3 e 15/i);
});

test("normaliza exemplos de escrita e gera guia heurístico", async () => {
  const sample = normalizeStyleSample({
    title: "Post de exemplo",
    sourceType: "post",
    content: "A notícia muda o cenário. O que acontece agora? Veja os principais pontos e acompanhe os próximos passos.",
  });
  assert.equal(sample.sourceType, "post");
  assert.ok(sample.charCount >= 40);
  assert.ok(sample.contentHash);
  const profile = await analyzeWritingStyle([sample]);
  assert.equal(profile.mode, "heuristic");
  assert.match(writingStylePrompt(profile), /TOM:|RITMO:/);
});


test("memória editorial aprende somente forma de carrosséis aprovados", () => {
  const example = normalizeCarouselLearningExample({
    topicId: "politica-1",
    sourceName: "Portal Teste",
    slideCount: 5,
    slides: [
      { role: "Título principal", title: "Pesquisa mostra disputa apertada", subtitle: "O levantamento registra diferença dentro da margem de erro." },
      { role: "Contexto", title: "Como foi feito o levantamento", subtitle: "A pesquisa ouviu eleitores em diferentes regiões do país." },
      { role: "Informação principal", title: "O principal resultado", subtitle: "Os percentuais divulgados indicam um cenário competitivo." },
      { role: "Conclusão", title: "O que os dados permitem concluir", subtitle: "O resultado retrata o momento da coleta e pode mudar até a votação." },
      { role: "CTA", title: "Continue acompanhando", subtitle: "Acompanhe as próximas atualizações." },
    ],
  });
  const memory = summarizeCarouselLearning([{ ...example, createdAt: new Date().toISOString() }]);
  assert.equal(memory.count, 1);
  assert.match(memory.prompt, /MEMÓRIA EDITORIAL APROVADA/);
  assert.match(memory.prompt, /Não reutilize nomes, números, fatos ou frases/i);
  assert.doesNotMatch(memory.prompt, /Pesquisa mostra disputa apertada|Portal Teste/);
});
