import { describe, it, expect } from 'vitest';

process.env.DB_PATH = ':memory:';

import { routeAidoModel, getPriorityForCategory } from '../src/models/router.js';

describe('routeAidoModel', () => {
  describe('auto category', () => {
    it('routes aido/auto to auto with big-pickle', () => {
      const result = routeAidoModel('aido/auto');
      expect(result.provider).toBe('auto');
      expect(result.model).toBe('big-pickle');
      expect(result.isAuto).toBe(true);
    });

    it('routes aido/auto to first available in AUTO_PRIORITY', () => {
      const result = routeAidoModel('aido/auto');
      expect(result.upstreamPath).toBe('/v1/chat/completions');
    });
  });

  describe('cloud category', () => {
    it('routes aido/cloud to auto-routing with cloud priority', () => {
      const result = routeAidoModel('aido/cloud');
      expect(result.provider).toBe('auto');
      expect(result.model).toBe('auto');
      expect(result.isAuto).toBe(true);
      expect(result.priorityType).toBe('cloud');
    });

    it('routes aido/cloud/big-pickle to auto-routing with specified model', () => {
      const result = routeAidoModel('aido/cloud/big-pickle');
      expect(result.provider).toBe('auto');
      expect(result.model).toBe('big-pickle');
      expect(result.isAuto).toBe(true);
      expect(result.priorityType).toBe('cloud');
    });

    it('routes aido/cloud/gpt-4o-mini to auto-routing with specified model', () => {
      const result = routeAidoModel('aido/cloud/gpt-4o-mini');
      expect(result.provider).toBe('auto');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.isAuto).toBe(true);
      expect(result.priorityType).toBe('cloud');
    });
  });

  describe('local category', () => {
    it('routes aido/local to ollama-local with qwen3:8b', () => {
      const result = routeAidoModel('aido/local');
      expect(result.provider).toBe('ollama-local');
      expect(result.model).toBe('qwen3:8b');
      expect(result.isAuto).toBe(true);
    });

    it('routes aido/local/qwen3:8b to ollama-local', () => {
      const result = routeAidoModel('aido/local/qwen3:8b');
      expect(result.provider).toBe('ollama-local');
      expect(result.model).toBe('qwen3:8b');
      expect(result.isAuto).toBe(false);
    });

    it('routes aido/local/glm-4.7-flash to ollama-local', () => {
      const result = routeAidoModel('aido/local/glm-4.7-flash');
      expect(result.provider).toBe('ollama-local');
      expect(result.model).toBe('glm-4.7-flash');
      expect(result.isAuto).toBe(false);
    });
  });

   describe('provider category', () => {
     it('routes aido/opencode/big-pickle to opencode', () => {
       const result = routeAidoModel('aido/opencode/big-pickle');
       expect(result.provider).toBe('opencode');
       expect(result.model).toBe('big-pickle');
       expect(result.isAuto).toBe(false);
     });

    it('routes aido/ollama/glm-5:cloud to ollama', () => {
      const result = routeAidoModel('aido/ollama/glm-5:cloud');
      expect(result.provider).toBe('ollama');
      expect(result.model).toBe('glm-5:cloud');
      expect(result.isAuto).toBe(false);
    });

     it('auto-adds :cloud suffix for known cloud models', () => {
       const result = routeAidoModel('aido/opencode/glm-5');
       expect(result.provider).toBe('opencode');
       expect(result.model).toBe('glm-5:cloud');
     });

    it('routes aido/openai/gpt-4o-mini to openai', () => {
      const result = routeAidoModel('aido/openai/gpt-4o-mini');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
      expect(result.isAuto).toBe(false);
    });

    it('routes aido/anthropic/claude-haiku-4-5 to anthropic', () => {
      const result = routeAidoModel('aido/anthropic/claude-haiku-4-5');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4-5');
      expect(result.isAuto).toBe(false);
    });

    it('routes aido/groq/llama3-8b-8192 to groq', () => {
      const result = routeAidoModel('aido/groq/llama3-8b-8192');
      expect(result.provider).toBe('groq');
      expect(result.model).toBe('llama3-8b-8192');
      expect(result.isAuto).toBe(false);
    });
  });

  describe('error handling', () => {
    it('throws for invalid aido path', () => {
      expect(() => routeAidoModel('aido/unknown')).toThrow();
    });

    it('throws for missing model in provider path', () => {
      expect(() => routeAidoModel('aido/zen')).toThrow();
    });
  });
});

describe('getPriorityForCategory', () => {
   it('returns AUTO_PRIORITY for auto', () => {
     const priority = getPriorityForCategory('auto');
     expect(priority[0].provider).toBe('opencode');
     expect(priority[0].model).toBe('big-pickle');
   });

   it('returns CLOUD_PRIORITY for cloud', () => {
     const priority = getPriorityForCategory('cloud');
     expect(priority[0].provider).toBe('opencode');
   });

  it('CLOUD_PRIORITY includes ollama-local with :cloud models', () => {
    const priority = getPriorityForCategory('cloud');
    const ollamaLocalProvider = priority.find(p => p.provider === 'ollama-local');
    expect(ollamaLocalProvider).toBeDefined();
    expect(ollamaLocalProvider?.model).toBe('glm-5:cloud');
  });

  it('returns LOCAL_PRIORITY for local', () => {
    const priority = getPriorityForCategory('local');
    expect(priority[0].provider).toBe('ollama-local');
    expect(priority[0].model).toBe('qwen3:8b');
  });

   it('returns AUTO_PRIORITY for provider', () => {
     const priority = getPriorityForCategory('provider');
     expect(priority[0].provider).toBe('opencode');
   });

   it('routes aido/opencode (no model) to auto-select model', () => {
     const result = routeAidoModel('aido/opencode');
     expect(result.provider).toBe('opencode');
     expect(result.model).toBe('auto');
     expect(result.isAuto).toBe(true);
   });

   it('routes aido/groq (no model) to auto-select model', () => {
     const result = routeAidoModel('aido/groq');
     expect(result.provider).toBe('groq');
     expect(result.model).toBe('auto');
     expect(result.isAuto).toBe(true);
   });

   it('routes aido/openai (no model) to auto-select model', () => {
     const result = routeAidoModel('aido/openai');
     expect(result.provider).toBe('openai');
     expect(result.model).toBe('auto');
     expect(result.isAuto).toBe(true);
   });
});

describe('cloud model detection', () => {
  it('routes cloud model to ollama-local when in LOCAL_CLOUD_MODELS', async () => {
    const { routeAidoModel, refreshCloudModels } = await import('../src/models/router.js');
    await refreshCloudModels();
    const result = routeAidoModel('aido/cloud/glm-5:cloud');
    expect(result.provider).toBe('ollama-local');
    expect(result.priorityType).toBe('local');
  });

  it('routes unknown cloud model to auto-routing with cloud priority', async () => {
    const { routeAidoModel, refreshCloudModels } = await import('../src/models/router.js');
    await refreshCloudModels();
    const result = routeAidoModel('aido/cloud/gpt-4o-mini');
    expect(result.provider).toBe('auto');
    expect(result.priorityType).toBe('cloud');
    expect(result.isAuto).toBe(true);
  });
});
